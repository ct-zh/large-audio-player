#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use rodio::{Decoder as RodioDecoder, OutputStream, OutputStreamBuilder, Sink, Source};
use std::{
    collections::HashMap,
    fs::File,
    io::BufReader,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    time::UNIX_EPOCH,
};
use symphonia::core::{
    audio::{AudioBufferRef, SampleBuffer},
    codecs::{CodecParameters, DecoderOptions, CODEC_TYPE_NULL},
    errors::Error as SymphoniaError,
    formats::{FormatOptions, SeekMode, SeekTo},
    io::MediaSourceStream,
    meta::MetadataOptions,
    probe::Hint,
    units::Time,
};
use tauri::{AppHandle, Emitter, Manager, State};

const DEFAULT_OVERVIEW_POINTS: usize = 720;
const FALLBACK_FRAMES_PER_BUCKET: usize = 8_192;

struct AppState {
    current_file: Mutex<Option<AudioMeta>>,
    playback: PlaybackController,
    waveform_generation: AtomicU64,
    waveform_cache: Mutex<HashMap<String, HashMap<String, Vec<WaveformPoint>>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudioMeta {
    path: String,
    file_name: String,
    file_size: u64,
    duration_sec: u64,
    sample_rate: u32,
    channels: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenAudioResult {
    audio_meta: AudioMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct EqSettings {
    low: f32,
    mid: f32,
    high: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WaveformPoint {
    min: f32,
    max: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WaveformOverviewPayload {
    points: Vec<WaveformPoint>,
    progress: f32,
    resolution: String,
    window_start_sec: f64,
    window_end_sec: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaybackStatus {
    position_sec: f64,
    is_playing: bool,
}

#[derive(Debug, Clone)]
struct PlaybackRuntimeState {
    is_playing: bool,
    position_sec: f64,
}

impl Default for PlaybackRuntimeState {
    fn default() -> Self {
        Self {
            is_playing: false,
            position_sec: 0.0,
        }
    }
}

struct PlaybackSession {
    path: String,
    gain: f32,
    eq: EqSettings,
    stream: OutputStream,
    sink: Sink,
}

struct PlaybackController {
    sender: Sender<PlaybackCommand>,
}

enum PlaybackCommand {
    Open {
        path: String,
        gain: f32,
        eq: EqSettings,
        reply: Sender<Result<(), String>>,
    },
    Play {
        reply: Sender<Result<(), String>>,
    },
    Pause {
        reply: Sender<Result<(), String>>,
    },
    Seek {
        position_sec: f64,
        reply: Sender<Result<(), String>>,
    },
    SetGain {
        gain: f32,
        reply: Sender<Result<(), String>>,
    },
    SetEq {
        eq: EqSettings,
        reply: Sender<Result<(), String>>,
    },
    GetStatus {
        reply: Sender<PlaybackStatus>,
    },
    Close {
        reply: Sender<Result<(), String>>,
    },
}

impl AppState {
    fn new(app: AppHandle) -> Self {
        let (sender, receiver) = mpsc::channel();
        let runtime_state = Arc::new(Mutex::new(PlaybackRuntimeState::default()));
        let worker_state = Arc::clone(&runtime_state);
        let worker_app = app.clone();

        thread::spawn(move || {
            playback_worker(receiver, worker_state, worker_app);
        });

        Self {
            current_file: Mutex::new(None),
            playback: PlaybackController { sender },
            waveform_generation: AtomicU64::new(0),
            waveform_cache: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone, Copy, Default)]
struct AggregateBin {
    min: f32,
    max: f32,
    seen: bool,
}

impl AggregateBin {
    fn update(&mut self, min: f32, max: f32) {
        if !self.seen {
            self.min = min;
            self.max = max;
            self.seen = true;
            return;
        }

        self.min = self.min.min(min);
        self.max = self.max.max(max);
    }
}

struct WaveformAccumulator {
    point_count: usize,
    total_frames: Option<u64>,
    processed_frames: u64,
    direct_bins: Vec<AggregateBin>,
    fallback_bins: Vec<AggregateBin>,
    fallback_frames_in_bucket: usize,
    fallback_current: AggregateBin,
}

impl WaveformAccumulator {
    fn new(total_frames: Option<u64>, point_count: usize) -> Self {
        Self {
            point_count,
            total_frames,
            processed_frames: 0,
            direct_bins: vec![AggregateBin::default(); point_count],
            fallback_bins: Vec::new(),
            fallback_frames_in_bucket: 0,
            fallback_current: AggregateBin::default(),
        }
    }

    fn push_frame(&mut self, min: f32, max: f32) {
        if let Some(total_frames) = self.total_frames.filter(|value| *value > 0) {
            let last_index = self.point_count.saturating_sub(1) as u64;
            let bucket =
                ((self.processed_frames.saturating_mul(self.point_count as u64)) / total_frames)
                    .min(last_index) as usize;
            self.direct_bins[bucket].update(min, max);
        } else {
            self.fallback_current.update(min, max);
            self.fallback_frames_in_bucket += 1;

            if self.fallback_frames_in_bucket >= FALLBACK_FRAMES_PER_BUCKET {
                self.fallback_bins.push(self.fallback_current);
                self.fallback_current = AggregateBin::default();
                self.fallback_frames_in_bucket = 0;
            }
        }

        self.processed_frames += 1;
    }

    fn progress(&self) -> Option<f32> {
        self.total_frames
            .filter(|value| *value > 0)
            .map(|total| (self.processed_frames as f32 / total as f32).clamp(0.0, 1.0))
    }

    fn finalize(mut self) -> Vec<WaveformPoint> {
        if self.total_frames.is_some() {
            return self
                .direct_bins
                .into_iter()
                .map(|bin| {
                    if bin.seen {
                        WaveformPoint {
                            min: bin.min,
                            max: bin.max,
                        }
                    } else {
                        WaveformPoint { min: 0.0, max: 0.0 }
                    }
                })
                .collect();
        }

        if self.fallback_current.seen {
            self.fallback_bins.push(self.fallback_current);
        }

        if self.fallback_bins.is_empty() {
            return vec![WaveformPoint { min: 0.0, max: 0.0 }; self.point_count];
        }

        let mut output = Vec::with_capacity(self.point_count);

        for bucket_index in 0..self.point_count {
            let start = (bucket_index * self.fallback_bins.len()) / self.point_count;
            let mut end =
                ((bucket_index + 1) * self.fallback_bins.len()) / self.point_count;

            if end <= start {
                end = (start + 1).min(self.fallback_bins.len());
            }

            let mut aggregate = AggregateBin::default();
            for bin in &self.fallback_bins[start..end] {
                if bin.seen {
                    aggregate.update(bin.min, bin.max);
                }
            }

            if aggregate.seen {
                output.push(WaveformPoint {
                    min: aggregate.min,
                    max: aggregate.max,
                });
            } else {
                output.push(WaveformPoint { min: 0.0, max: 0.0 });
            }
        }

        output
    }
}

struct DecodingContext {
    format: Box<dyn symphonia::core::formats::FormatReader>,
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    track_id: u32,
    audio_meta: AudioMeta,
}

fn decode_error(error: SymphoniaError) -> String {
    match error {
        SymphoniaError::IoError(inner) => inner.to_string(),
        SymphoniaError::DecodeError(inner) => inner.to_string(),
        other => other.to_string(),
    }
}

fn open_decoding_context(path: &Path) -> Result<DecodingContext, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let file_size = file.metadata().map_err(|error| error.to_string())?.len();

    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }

    let media_source = MediaSourceStream::new(Box::new(file), Default::default());
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            media_source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(decode_error)?;

    let format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "No playable audio track found.".to_string())?;
    let track_id = track.id;
    let codec_params = track.codec_params.clone();

    if codec_params.codec == CODEC_TYPE_NULL {
        return Err("Unsupported audio codec.".to_string());
    }

    let decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(decode_error)?;

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("audio-file")
        .to_string();

    let mut duration_sec = duration_from_codec_params(&codec_params);
    if duration_sec == 0 {
        duration_sec = estimate_duration_from_packets(path, track_id, &codec_params)?;
    }

    let audio_meta = AudioMeta {
        path: path.to_string_lossy().to_string(),
        file_name,
        file_size,
        duration_sec,
        sample_rate: codec_params.sample_rate.unwrap_or(44_100),
        channels: codec_params
            .channels
            .map(|channels| channels.count() as u16)
            .unwrap_or(2),
    };

    Ok(DecodingContext {
        format,
        decoder,
        track_id,
        audio_meta,
    })
}

fn duration_from_codec_params(codec_params: &CodecParameters) -> u64 {
    if let (Some(frame_count), Some(sample_rate)) = (codec_params.n_frames, codec_params.sample_rate)
    {
        return ((frame_count as f64) / (sample_rate as f64)).ceil() as u64;
    }

    if let (Some(frame_count), Some(time_base)) = (codec_params.n_frames, codec_params.time_base) {
        let time = time_base.calc_time(frame_count);
        return time.seconds + u64::from(time.frac > 0.0);
    }

    0
}

fn seconds_from_timestamp(timestamp: u64, codec_params: &CodecParameters) -> Option<f64> {
    if timestamp == 0 {
        return Some(0.0);
    }

    if let Some(time_base) = codec_params.time_base {
        let time = time_base.calc_time(timestamp);
        return Some(time.seconds as f64 + time.frac);
    }

    codec_params
        .sample_rate
        .filter(|sample_rate| *sample_rate > 0)
        .map(|sample_rate| timestamp as f64 / sample_rate as f64)
}

fn estimate_duration_from_packets(
    path: &Path,
    track_id: u32,
    codec_params: &CodecParameters,
) -> Result<u64, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;

    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }

    let media_source = MediaSourceStream::new(Box::new(file), Default::default());
    let mut format = symphonia::default::get_probe()
        .format(
            &hint,
            media_source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(decode_error)?
        .format;

    let mut duration_ts = 0_u64;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(error) => return Err(decode_error(error)),
        };

        if packet.track_id() != track_id {
            continue;
        }

        duration_ts = duration_ts.max(packet.ts().saturating_add(packet.dur()));
    }

    Ok(seconds_from_timestamp(duration_ts, codec_params)
        .map(|seconds| seconds.ceil() as u64)
        .unwrap_or(0))
}

fn append_audio_buffer_windowed(
    buffer: AudioBufferRef<'_>,
    accumulator: &mut WaveformAccumulator,
    frame_cursor: &mut u64,
    frame_start: Option<u64>,
    frame_end: Option<u64>,
) -> bool {
    let channels = buffer.spec().channels.count().max(1);
    let mut sample_buffer = SampleBuffer::<f32>::new(buffer.capacity() as u64, *buffer.spec());
    sample_buffer.copy_interleaved_ref(buffer);

    for frame in sample_buffer.samples().chunks(channels) {
        let current_frame = *frame_cursor;

        if let Some(end) = frame_end {
          if current_frame >= end {
            return true;
          }
        }

        if frame_start.is_none_or(|start| current_frame >= start) {
            let mut frame_min = 1.0_f32;
            let mut frame_max = -1.0_f32;

            for sample in frame {
                frame_min = frame_min.min(*sample);
                frame_max = frame_max.max(*sample);
            }

            accumulator.push_frame(frame_min, frame_max);
        }

        *frame_cursor += 1;
    }

    false
}

fn waveform_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("waveforms");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn waveform_memory_key(point_count: usize, window_start_sec: f64, window_end_sec: f64) -> String {
    format!("{point_count}:{window_start_sec:.3}:{window_end_sec:.3}")
}

fn waveform_cache_file(
    path: &str,
    point_count: usize,
    window_start_sec: f64,
    window_end_sec: f64,
    app: &AppHandle,
) -> Result<PathBuf, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or(0);

    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    modified.hash(&mut hasher);
    point_count.hash(&mut hasher);
    format!("{window_start_sec:.3}").hash(&mut hasher);
    format!("{window_end_sec:.3}").hash(&mut hasher);
    let file_name = format!("{:016x}.json", hasher.finish());

    Ok(waveform_cache_dir(app)?.join(file_name))
}

fn load_waveform_from_disk(
    path: &str,
    point_count: usize,
    window_start_sec: f64,
    window_end_sec: f64,
    app: &AppHandle,
) -> Result<Option<Vec<WaveformPoint>>, String> {
    let cache_file =
        waveform_cache_file(path, point_count, window_start_sec, window_end_sec, app)?;

    if !cache_file.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(cache_file).map_err(|error| error.to_string())?;
    let points =
        serde_json::from_str::<Vec<WaveformPoint>>(&contents).map_err(|error| error.to_string())?;
    Ok(Some(points))
}

fn save_waveform_to_disk(
    path: &str,
    point_count: usize,
    window_start_sec: f64,
    window_end_sec: f64,
    points: &[WaveformPoint],
    app: &AppHandle,
) -> Result<(), String> {
    let cache_file =
        waveform_cache_file(path, point_count, window_start_sec, window_end_sec, app)?;
    let contents = serde_json::to_string(points).map_err(|error| error.to_string())?;
    fs::write(cache_file, contents).map_err(|error| error.to_string())
}

fn build_waveform_overview(
    path: String,
    app: AppHandle,
    state: Arc<AppState>,
    job_id: u64,
    point_count: usize,
    window_start_sec: f64,
    window_end_sec: f64,
) -> Result<(), String> {
    let mut context = open_decoding_context(Path::new(&path))?;
    let sample_rate = context.audio_meta.sample_rate as f64;
    let frame_start = if window_start_sec > 0.0 {
        Some((window_start_sec * sample_rate).floor() as u64)
    } else {
        None
    };
    let frame_end = if window_end_sec > 0.0 {
        Some((window_end_sec * sample_rate).ceil() as u64)
    } else {
        None
    };
    let requested_total_frames = match (frame_start, frame_end) {
        (Some(start), Some(end)) if end > start => Some(end - start),
        _ => context.decoder.codec_params().n_frames,
    };
    let mut accumulator = WaveformAccumulator::new(requested_total_frames, point_count);
    let mut last_emitted_bucket = 0_u8;
    let mut frame_cursor = 0_u64;
    let resolution = if point_count > DEFAULT_OVERVIEW_POINTS {
        "detail"
    } else {
        "overview"
    };

    if window_start_sec > 0.0 {
        if let Ok(seeked_to) = context.format.seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time: Time::from(window_start_sec),
                track_id: Some(context.track_id),
            },
        ) {
            context.decoder.reset();

            frame_cursor = seconds_from_timestamp(seeked_to.actual_ts, context.decoder.codec_params())
                .map(|seconds| (seconds * sample_rate).floor() as u64)
                .unwrap_or_else(|| frame_start.unwrap_or(0));
        }
    }

    let initial_payload = WaveformOverviewPayload {
        points: Vec::new(),
        progress: 0.02,
        resolution: resolution.to_string(),
        window_start_sec,
        window_end_sec,
    };

    let _ = app.emit("waveform_progress", initial_payload);

    loop {
        if state.waveform_generation.load(Ordering::SeqCst) != job_id {
            return Ok(());
        }

        let packet = match context.format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(error) => return Err(decode_error(error)),
        };

        if packet.track_id() != context.track_id {
            continue;
        }

        match context.decoder.decode(&packet) {
            Ok(audio_buffer) => {
                let reached_end = append_audio_buffer_windowed(
                    audio_buffer,
                    &mut accumulator,
                    &mut frame_cursor,
                    frame_start,
                    frame_end,
                );

                if let Some(progress) = accumulator.progress() {
                    let bucket = (progress * 10.0).floor() as u8;
                    if bucket > last_emitted_bucket && bucket < 10 {
                        last_emitted_bucket = bucket;
                        let _ = app.emit(
                            "waveform_progress",
                            WaveformOverviewPayload {
                                points: Vec::new(),
                                progress,
                                resolution: resolution.to_string(),
                                window_start_sec,
                                window_end_sec,
                            },
                        );
                    }
                }

                if reached_end {
                    break;
                }
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(SymphoniaError::ResetRequired) => {
                return Err("Audio stream reset is not supported in this build.".to_string())
            }
            Err(error) => return Err(decode_error(error)),
        }
    }

    if state.waveform_generation.load(Ordering::SeqCst) != job_id {
        return Ok(());
    }

    let ready_payload = WaveformOverviewPayload {
        points: accumulator.finalize(),
        progress: 1.0,
        resolution: resolution.to_string(),
        window_start_sec,
        window_end_sec,
    };

    if let Ok(mut cache) = state.waveform_cache.lock() {
        if cache.len() > 4 {
            if let Some(oldest_key) = cache.keys().next().cloned() {
                cache.remove(&oldest_key);
            }
        }

        cache.entry(path.clone())
            .or_default()
            .insert(
                waveform_memory_key(point_count, window_start_sec, window_end_sec),
                ready_payload.points.clone(),
            );
    }

    let _ = save_waveform_to_disk(
        &path,
        point_count,
        window_start_sec,
        window_end_sec,
        &ready_payload.points,
        &app,
    );

    let _ = app.emit(
        "waveform_progress",
        WaveformOverviewPayload {
            points: Vec::new(),
            progress: 1.0,
            resolution: resolution.to_string(),
            window_start_sec,
            window_end_sec,
        },
    );
    let _ = app.emit("waveform_overview_ready", ready_payload);

    Ok(())
}

fn eq_band_gain(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

fn create_playback_session(
    path: &str,
    gain: f32,
    eq: EqSettings,
    start_at: Duration,
    should_play: bool,
) -> Result<PlaybackSession, String> {
    let stream = OutputStreamBuilder::open_default_stream().map_err(|error| error.to_string())?;
    let sink = Sink::connect_new(stream.mixer());
    let low = RodioDecoder::try_from(BufReader::new(
        File::open(path).map_err(|error| error.to_string())?,
    ))
    .map_err(|error| error.to_string())?
    .skip_duration(start_at)
    .low_pass(220)
    .amplify(eq_band_gain(eq.low));
    let mid = RodioDecoder::try_from(BufReader::new(
        File::open(path).map_err(|error| error.to_string())?,
    ))
    .map_err(|error| error.to_string())?
    .skip_duration(start_at)
    .high_pass(220)
    .low_pass(4_000)
    .amplify(eq_band_gain(eq.mid));
    let high = RodioDecoder::try_from(BufReader::new(
        File::open(path).map_err(|error| error.to_string())?,
    ))
    .map_err(|error| error.to_string())?
    .skip_duration(start_at)
    .high_pass(4_000)
    .amplify(eq_band_gain(eq.high));

    sink.append(low.mix(mid).mix(high));
    sink.set_volume(gain.max(0.0));

    if !should_play {
        sink.pause();
    }

    Ok(PlaybackSession {
        path: path.to_string(),
        gain,
        eq,
        stream,
        sink,
    })
}

fn update_runtime_status(
    runtime_state: &Arc<Mutex<PlaybackRuntimeState>>,
    position_sec: f64,
    is_playing: bool,
) {
    if let Ok(mut state) = runtime_state.lock() {
        state.position_sec = position_sec;
        state.is_playing = is_playing;
    }
}

fn emit_playback_status(app: &AppHandle, runtime_state: &Arc<Mutex<PlaybackRuntimeState>>) {
    if let Ok(state) = runtime_state.lock() {
        let _ = app.emit(
            "playback_status",
            PlaybackStatus {
                position_sec: state.position_sec,
                is_playing: state.is_playing,
            },
        );
    }
}

fn is_session_playing(session: &PlaybackSession) -> bool {
    !session.sink.is_paused() && !session.sink.empty()
}

fn playback_worker(
    receiver: Receiver<PlaybackCommand>,
    runtime_state: Arc<Mutex<PlaybackRuntimeState>>,
    app: AppHandle,
) {
    let mut session: Option<PlaybackSession> = None;

    loop {
        match receiver.recv_timeout(Duration::from_millis(200)) {
            Ok(command) => match command {
            PlaybackCommand::Open { path, gain, eq, reply } => {
                let result = create_playback_session(&path, gain, eq, Duration::ZERO, false).map(|next_session| {
                    update_runtime_status(&runtime_state, 0.0, false);
                    session = Some(next_session);
                    emit_playback_status(&app, &runtime_state);
                });
                let _ = reply.send(result.map(|_| ()));
            }
            PlaybackCommand::Play { reply } => {
                let result = session
                    .as_ref()
                    .ok_or_else(|| "No audio loaded for playback.".to_string())
                    .map(|current| {
                        let _keep_stream_alive = &current.stream;
                        current.sink.play();
                        update_runtime_status(
                            &runtime_state,
                            current.sink.get_pos().as_secs_f64(),
                            is_session_playing(current),
                        );
                        emit_playback_status(&app, &runtime_state);
                    });
                let _ = reply.send(result.map(|_| ()));
            }
            PlaybackCommand::Pause { reply } => {
                let result = session
                    .as_ref()
                    .ok_or_else(|| "No audio loaded for playback.".to_string())
                    .map(|current| {
                        current.sink.pause();
                        update_runtime_status(
                            &runtime_state,
                            current.sink.get_pos().as_secs_f64(),
                            is_session_playing(current),
                        );
                        emit_playback_status(&app, &runtime_state);
                    });
                let _ = reply.send(result.map(|_| ()));
            }
            PlaybackCommand::Seek { position_sec, reply } => {
                let snapshot = session
                    .as_ref()
                    .map(|current| {
                        (
                            current.path.clone(),
                            current.gain,
                            current.eq.clone(),
                            is_session_playing(current),
                        )
                    })
                    .ok_or_else(|| "No audio loaded for playback.".to_string());
                let result = snapshot.and_then(|(path, gain, eq, was_playing)| {
                    let next_session = create_playback_session(
                        &path,
                        gain,
                        eq,
                        Duration::from_secs_f64(position_sec.max(0.0)),
                        was_playing,
                    )?;
                    update_runtime_status(
                        &runtime_state,
                        position_sec.max(0.0),
                        is_session_playing(&next_session),
                    );
                    session = Some(next_session);
                    emit_playback_status(&app, &runtime_state);
                    Ok(())
                });
                let _ = reply.send(result);
            }
            PlaybackCommand::SetGain { gain, reply } => {
                let result = session
                    .as_mut()
                    .ok_or_else(|| "No audio loaded for playback.".to_string())
                    .map(|current| {
                        current.gain = gain;
                        current.sink.set_volume(current.gain.max(0.0));
                        update_runtime_status(
                            &runtime_state,
                            current.sink.get_pos().as_secs_f64(),
                            is_session_playing(current),
                        );
                        emit_playback_status(&app, &runtime_state);
                    });
                let _ = reply.send(result.map(|_| ()));
            }
            PlaybackCommand::SetEq { eq, reply } => {
                let snapshot = session
                    .as_ref()
                    .map(|current| {
                        (
                            current.path.clone(),
                            current.gain,
                            current.sink.get_pos(),
                            is_session_playing(current),
                        )
                    })
                    .ok_or_else(|| "No audio loaded for playback.".to_string());
                let result = snapshot.and_then(|(path, gain, position, was_playing)| {
                    let next_session =
                        create_playback_session(&path, gain, eq, position, was_playing)?;
                    update_runtime_status(
                        &runtime_state,
                        position.as_secs_f64(),
                        is_session_playing(&next_session),
                    );
                    session = Some(next_session);
                    emit_playback_status(&app, &runtime_state);
                    Ok(())
                });
                let _ = reply.send(result);
            }
            PlaybackCommand::GetStatus { reply } => {
                let status = if let Some(current) = session.as_ref() {
                    PlaybackStatus {
                        position_sec: current.sink.get_pos().as_secs_f64(),
                        is_playing: is_session_playing(current),
                    }
                } else {
                    PlaybackStatus {
                        position_sec: 0.0,
                        is_playing: false,
                    }
                };

                update_runtime_status(&runtime_state, status.position_sec, status.is_playing);
                let _ = reply.send(status);
            }
            PlaybackCommand::Close { reply } => {
                session = None;
                update_runtime_status(&runtime_state, 0.0, false);
                emit_playback_status(&app, &runtime_state);
                let _ = reply.send(Ok(()));
            }
            },
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Some(current) = session.as_ref() {
                    update_runtime_status(
                        &runtime_state,
                        current.sink.get_pos().as_secs_f64(),
                        is_session_playing(current),
                    );
                    emit_playback_status(&app, &runtime_state);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn send_playback_command(
    controller: &PlaybackController,
    build: impl FnOnce(Sender<Result<(), String>>) -> PlaybackCommand,
) -> Result<(), String> {
    let (reply_tx, reply_rx) = mpsc::channel();
    controller
        .sender
        .send(build(reply_tx))
        .map_err(|_| "Playback worker is unavailable.".to_string())?;
    reply_rx
        .recv()
        .map_err(|_| "Playback worker did not return a response.".to_string())?
}

#[tauri::command]
fn open_audio(path: String, state: State<'_, Arc<AppState>>) -> Result<OpenAudioResult, String> {
    let path_ref = Path::new(&path);
    let context = open_decoding_context(path_ref)?;
    let audio_meta = context.audio_meta;
    state.waveform_generation.fetch_add(1, Ordering::SeqCst);
    send_playback_command(&state.playback, |reply| PlaybackCommand::Open {
        path: audio_meta.path.clone(),
        gain: 1.0,
        eq: EqSettings::default(),
        reply,
    })?;

    *state.current_file.lock().map_err(|_| "state lock poisoned")? = Some(audio_meta.clone());

    Ok(OpenAudioResult { audio_meta })
}

#[tauri::command]
fn play(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    send_playback_command(&state.playback, |reply| PlaybackCommand::Play { reply })
}

#[tauri::command]
fn pause(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    send_playback_command(&state.playback, |reply| PlaybackCommand::Pause { reply })
}

#[tauri::command]
fn seek(position_sec: f64, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    send_playback_command(&state.playback, |reply| PlaybackCommand::Seek {
        position_sec,
        reply,
    })
}

#[tauri::command]
fn set_gain(gain: f64, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    send_playback_command(&state.playback, |reply| PlaybackCommand::SetGain {
        gain: gain as f32,
        reply,
    })
}

#[tauri::command]
fn set_eq(eq: EqSettings, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    send_playback_command(&state.playback, |reply| PlaybackCommand::SetEq { eq, reply })
}

#[tauri::command]
fn get_playback_status(state: State<'_, Arc<AppState>>) -> Result<PlaybackStatus, String> {
    let (reply_tx, reply_rx) = mpsc::channel();
    state
        .playback
        .sender
        .send(PlaybackCommand::GetStatus { reply: reply_tx })
        .map_err(|_| "Playback worker is unavailable.".to_string())?;
    reply_rx
        .recv()
        .map_err(|_| "Playback worker did not return a status.".to_string())
}

#[tauri::command]
fn request_waveform_overview(
    path: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    point_count: Option<usize>,
    window_start_sec: Option<f64>,
    window_end_sec: Option<f64>,
) -> Result<WaveformOverviewPayload, String> {
    let requested_points = point_count.unwrap_or(DEFAULT_OVERVIEW_POINTS).clamp(360, 4_096);
    let duration_guess = if let Some(duration_sec) = state
        .current_file
        .lock()
        .ok()
        .and_then(|current| {
            current
                .as_ref()
                .filter(|audio_meta| audio_meta.path == path)
                .map(|audio_meta| audio_meta.duration_sec as f64)
        }) {
        duration_sec
    } else {
        open_decoding_context(Path::new(&path))?.audio_meta.duration_sec as f64
    };
    let requested_window_start = window_start_sec.unwrap_or(0.0).max(0.0);
    let requested_window_end = window_end_sec
        .unwrap_or(duration_guess)
        .max(requested_window_start)
        .min(duration_guess.max(requested_window_start));
    let is_windowed = requested_window_start > 0.0 || requested_window_end < duration_guess;
    let resolution = if requested_points > DEFAULT_OVERVIEW_POINTS {
        "detail"
    } else {
        "overview"
    };

    if let Ok(cache) = state.waveform_cache.lock() {
        if let Some(points) = cache
            .get(&path)
            .and_then(|layers| {
                layers.get(&waveform_memory_key(
                    requested_points,
                    requested_window_start,
                    requested_window_end,
                ))
            })
            .cloned()
        {
            let payload = WaveformOverviewPayload {
                points,
                progress: 1.0,
                resolution: resolution.to_string(),
                window_start_sec: requested_window_start,
                window_end_sec: requested_window_end,
            };
            let _ = app.emit("waveform_overview_ready", payload.clone());
            return Ok(payload);
        }
    }

    if let Ok(Some(points)) = load_waveform_from_disk(
        &path,
        requested_points,
        requested_window_start,
        requested_window_end,
        &app,
    ) {
        if let Ok(mut cache) = state.waveform_cache.lock() {
            cache.entry(path.clone())
                .or_default()
                .insert(
                    waveform_memory_key(
                        requested_points,
                        requested_window_start,
                        requested_window_end,
                    ),
                    points.clone(),
                );
        }

        let payload = WaveformOverviewPayload {
            points,
            progress: 1.0,
            resolution: resolution.to_string(),
            window_start_sec: requested_window_start,
            window_end_sec: requested_window_end,
        };
        let _ = app.emit("waveform_overview_ready", payload.clone());
        return Ok(payload);
    }

    let job_id = state.waveform_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let app_handle = app.clone();
    let state_handle = state.inner().clone();
    let path_for_thread = path;

    thread::spawn(move || {
        let _ = build_waveform_overview(
            path_for_thread,
            app_handle,
            state_handle,
            job_id,
            requested_points,
            if is_windowed { requested_window_start } else { 0.0 },
            if is_windowed { requested_window_end } else { duration_guess },
        );
    });

    Ok(WaveformOverviewPayload {
        points: Vec::new(),
        progress: 0.02,
        resolution: resolution.to_string(),
        window_start_sec: requested_window_start,
        window_end_sec: requested_window_end,
    })
}

#[tauri::command]
fn close_current_audio(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    *state.current_file.lock().map_err(|_| "state lock poisoned")? = None;
    state.waveform_generation.fetch_add(1, Ordering::SeqCst);
    send_playback_command(&state.playback, |reply| PlaybackCommand::Close { reply })
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(Arc::new(AppState::new(app.handle().clone())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_audio,
            play,
            pause,
            seek,
            set_gain,
            set_eq,
            get_playback_status,
            request_waveform_overview,
            close_current_audio
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
