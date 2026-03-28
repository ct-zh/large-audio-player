import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "./lib/tauriBridge";
import { WaveformCanvas } from "./components/WaveformCanvas";
import type {
  AudioMeta,
  EqSettings,
  PlayerState,
  WaveformOverviewPayload,
  WaveformView
} from "./types";

const defaultEq: EqSettings = { low: 0, mid: 0, high: 0 };
const defaultWaveformView: WaveformView = {
  zoom: 1,
  amplitude: 1,
  colorScheme: "ocean"
};

const initialState: PlayerState = {
  phase: "idle",
  errorMessage: null,
  audioMeta: null,
  waveform: [],
  waveformProgress: 0,
  gain: 1,
  eq: defaultEq,
  currentTimeSec: 0,
  durationSec: 0,
  isPlaying: false,
  waveformWindowStartSec: 0,
  waveformWindowEndSec: 0
};

const formatBytes = (bytes: number) => {
  if (bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** power;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[power]}`;
};

const formatTime = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remain = seconds % 60;
  const core = `${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;

  return hours > 0 ? `${hours}:${core}` : core;
};

const getDesktopFilePath = (file: File) => {
  const desktopPath = (file as File & { path?: string }).path;
  return typeof desktopPath === "string" && desktopPath.length > 0 ? desktopPath : null;
};

const waveformTargetPoints = (zoom: number) => {
  if (zoom >= 5) {
    return 2880;
  }

  if (zoom >= 2.5) {
    return 1440;
  }

  return 720;
};

const waveformWindowForView = (durationSec: number, currentTimeSec: number, zoom: number) => {
  if (durationSec <= 0 || zoom < 2.5) {
    return {
      windowStartSec: 0,
      windowEndSec: durationSec
    };
  }

  const spanSec = Math.max(8, Math.min(durationSec, (durationSec / zoom) * 1.2));
  const maxStart = Math.max(0, durationSec - spanSec);
  const start = Math.max(0, Math.min(maxStart, currentTimeSec - spanSec / 2));

  return {
    windowStartSec: start,
    windowEndSec: Math.min(durationSec, start + spanSec)
  };
};

function App() {
  const [state, setState] = useState<PlayerState>(initialState);
  const [view, setView] = useState<WaveformView>(defaultWaveformView);
  const [isDragging, setIsDragging] = useState(false);
  const isDesktopTauri = bridge.isTauri();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const currentMeta = state.audioMeta;

  useEffect(() => {
    let unlistenProgress: () => void = () => {};
    let unlistenReady: () => void = () => {};
    let unlistenPlayback: () => void = () => {};

    const bind = async () => {
      unlistenProgress = await bridge.onWaveformProgress(handleWaveformUpdate);
      unlistenReady = await bridge.onWaveformReady(handleWaveformUpdate);
      unlistenPlayback = await bridge.onPlaybackStatus((status) => {
        setState((prev) => ({
          ...prev,
          currentTimeSec: status.positionSec,
          isPlaying: status.isPlaying
        }));
      });
    };

    void bind();

    return () => {
      unlistenProgress();
      unlistenReady();
      unlistenPlayback();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!currentMeta) {
      return;
    }

    const nextWindow = waveformWindowForView(state.durationSec, state.currentTimeSec, view.zoom);
    const currentSpan = state.waveformWindowEndSec - state.waveformWindowStartSec;
    const nextSpan = nextWindow.windowEndSec - nextWindow.windowStartSec;
    const needsDetailRefresh =
      view.zoom >= 2.5 &&
      (currentSpan <= 0 ||
        state.currentTimeSec < state.waveformWindowStartSec + currentSpan * 0.25 ||
        state.currentTimeSec > state.waveformWindowEndSec - currentSpan * 0.25 ||
        Math.abs(currentSpan - nextSpan) > 0.5);

    const needsOverviewRefresh = view.zoom < 2.5 && currentSpan !== state.durationSec;

    if (!needsDetailRefresh && !needsOverviewRefresh) {
      return;
    }

    const timer = window.setTimeout(() => {
      void bridge.requestWaveformOverview(
        currentMeta.path,
        undefined,
        waveformTargetPoints(view.zoom),
        nextWindow.windowStartSec,
        nextWindow.windowEndSec
      );
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    currentMeta,
    state.currentTimeSec,
    state.durationSec,
    state.waveformWindowEndSec,
    state.waveformWindowStartSec,
    view.zoom
  ]);

  const statusLabel = useMemo(() => {
    if (state.phase === "loading") {
      return "Preparing playback and generating waveform overview";
    }

    if (state.phase === "error") {
      return state.errorMessage ?? "Unknown error";
    }

    if (!currentMeta) {
      return "Drop a local WAV/MP3 file to start";
    }

    if (state.waveformProgress < 1) {
      return `Waveform overview ${Math.round(state.waveformProgress * 100)}%`;
    }

    return "Ready for playback";
  }, [currentMeta, state.errorMessage, state.phase, state.waveformProgress]);

  const resetPlaybackSideEffects = async () => {
    if (!isDesktopTauri && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }

    if (!isDesktopTauri && objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    await bridge.closeCurrentAudio();
  };

  const applyMetaToLocalAudio = async (file: File, meta: AudioMeta) => {
    if (isDesktopTauri) {
      setState((prev) => ({
        ...prev,
        audioMeta: meta,
        durationSec: meta.durationSec,
        currentTimeSec: 0
      }));
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    objectUrlRef.current = nextUrl;

    if (!audioRef.current) {
      return;
    }

    audioRef.current.src = nextUrl;
    audioRef.current.load();

    setState((prev) => ({
      ...prev,
      audioMeta: meta,
      durationSec: meta.durationSec,
      currentTimeSec: 0
    }));
  };

  const handleWaveformUpdate = (payload: WaveformOverviewPayload) => {
      setState((prev) => ({
        ...prev,
        waveform: payload.points.length > 0 ? payload.points : prev.waveform,
        waveformProgress: payload.progress,
        phase: prev.audioMeta ? "ready" : prev.phase,
        waveformWindowStartSec: payload.windowStartSec,
        waveformWindowEndSec: payload.windowEndSec
      }));
  };

  const handleFile = async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase();

    if (!extension || !["wav", "mp3"].includes(extension)) {
      setState((prev) => ({
        ...prev,
        phase: "error",
        errorMessage: "Only .wav and .mp3 files are supported in v1."
      }));
      return;
    }

    await resetPlaybackSideEffects();

    setState({
      ...initialState,
      phase: "loading"
    });

    try {
      const nativePath = getDesktopFilePath(file);
      const requestPath = nativePath ?? file.name;
      const { audioMeta } = await bridge.openAudio(requestPath, file);
      await applyMetaToLocalAudio(file, audioMeta);

      const overview = await bridge.requestWaveformOverview(
        requestPath,
        file,
        waveformTargetPoints(view.zoom),
        0,
        audioMeta.durationSec
      );

      setState((prev) => ({
        ...prev,
        phase: "ready",
        audioMeta,
        durationSec: audioMeta.durationSec,
        waveform: overview.points,
        waveformProgress: overview.progress,
        waveformWindowStartSec: overview.windowStartSec,
        waveformWindowEndSec: overview.windowEndSec
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        phase: "error",
        errorMessage: error instanceof Error ? error.message : "Failed to load audio."
      }));
    }
  };

  const handleInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file) {
      await handleFile(file);
    }

    event.target.value = "";
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files?.[0];
    if (file) {
      await handleFile(file);
    }
  };

  const togglePlayback = async () => {
    if (!currentMeta) {
      return;
    }

    if (isDesktopTauri) {
      if (state.isPlaying) {
        await bridge.pause();
        setState((prev) => ({ ...prev, isPlaying: false }));
        return;
      }

      await bridge.play();
      setState((prev) => ({ ...prev, isPlaying: true }));
      return;
    }

    if (!audioRef.current) {
      return;
    }

    if (state.isPlaying) {
      audioRef.current.pause();
      await bridge.pause();
      setState((prev) => ({ ...prev, isPlaying: false }));
      return;
    }

    await audioRef.current.play();
    await bridge.play();
    setState((prev) => ({ ...prev, isPlaying: true }));
  };

  const handleSeek = async (timeSec: number) => {
    if (state.durationSec <= 0) {
      return;
    }

    const bounded = Math.max(0, Math.min(timeSec, state.durationSec));

    if (!isDesktopTauri && audioRef.current) {
      audioRef.current.currentTime = bounded;
    }

    setState((prev) => ({ ...prev, currentTimeSec: bounded }));
    await bridge.seek(bounded);
  };

  const updateEq = async (key: keyof EqSettings, value: number) => {
    const eq = { ...state.eq, [key]: value };
    setState((prev) => ({ ...prev, eq }));
    await bridge.setEq(eq);
  };

  const updateGain = async (gain: number) => {
    setState((prev) => ({ ...prev, gain }));
    await bridge.setGain(gain);

    if (!isDesktopTauri && audioRef.current) {
      audioRef.current.volume = Math.max(0, Math.min(1, gain));
    }
  };

  return (
    <div className="app-shell">
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (isDesktopTauri || !audioRef.current) {
            return;
          }

          setState((prev) => ({
            ...prev,
            currentTimeSec: audioRef.current?.currentTime ?? prev.currentTimeSec
          }));
        }}
        onEnded={() => {
          setState((prev) => ({ ...prev, isPlaying: false }));
        }}
      />

      <aside className="sidebar">
        <div>
          <p className="eyebrow">Large File Audio Player</p>
          <h1>Open big audio files without waiting for full waveform analysis.</h1>
          <p className="muted">{statusLabel}</p>
        </div>

        <div className="panel">
          <label className="button">
            Choose audio
            <input
              type="file"
              accept=".wav,.mp3,audio/wav,audio/mpeg"
              onChange={handleInputChange}
              hidden
            />
          </label>
          <button
            className="ghost-button"
            type="button"
            onClick={async () => {
              const path = await bridge.openSystemAudioPicker();
              if (path) {
                const { audioMeta } = await bridge.openAudio(path);
                setState((prev) => ({
                  ...prev,
                  phase: "ready",
                  audioMeta,
                  durationSec: audioMeta.durationSec,
                  waveformProgress: 0
                }));
                const overview = await bridge.requestWaveformOverview(path);
                handleWaveformUpdate(overview);
              }
            }}
          >
            Open via system dialog
          </button>
        </div>

        <div className="panel">
          <h2>Audio chain</h2>
          <label>
            Gain {state.gain.toFixed(2)}
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={state.gain}
              onChange={(event) => {
                void updateGain(Number(event.target.value));
              }}
            />
          </label>
          <label>
            Low {state.eq.low.toFixed(1)} dB
            <input
              type="range"
              min="-12"
              max="12"
              step="0.5"
              value={state.eq.low}
              onChange={(event) => {
                void updateEq("low", Number(event.target.value));
              }}
            />
          </label>
          <label>
            Mid {state.eq.mid.toFixed(1)} dB
            <input
              type="range"
              min="-12"
              max="12"
              step="0.5"
              value={state.eq.mid}
              onChange={(event) => {
                void updateEq("mid", Number(event.target.value));
              }}
            />
          </label>
          <label>
            High {state.eq.high.toFixed(1)} dB
            <input
              type="range"
              min="-12"
              max="12"
              step="0.5"
              value={state.eq.high}
              onChange={(event) => {
                void updateEq("high", Number(event.target.value));
              }}
            />
          </label>
        </div>

        <div className="panel">
          <h2>Waveform view</h2>
          <label>
            Zoom {view.zoom.toFixed(1)}x
            <input
              type="range"
              min="0.6"
              max="8"
              step="0.1"
              value={view.zoom}
              onChange={(event) => {
                setView((prev) => ({ ...prev, zoom: Number(event.target.value) }));
              }}
            />
          </label>
          <label>
            Amplitude {view.amplitude.toFixed(1)}x
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={view.amplitude}
              onChange={(event) => {
                setView((prev) => ({ ...prev, amplitude: Number(event.target.value) }));
              }}
            />
          </label>
          <label>
            Palette
            <select
              value={view.colorScheme}
              onChange={(event) => {
                setView((prev) => ({
                  ...prev,
                  colorScheme: event.target.value as WaveformView["colorScheme"]
                }));
              }}
            >
              <option value="ocean">Ocean</option>
              <option value="sunset">Sunset</option>
              <option value="mono">Mono</option>
            </select>
          </label>
        </div>
      </aside>

      <main className="stage">
        <section
          className={`dropzone ${isDragging ? "dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (event.currentTarget === event.target) {
              setIsDragging(false);
            }
          }}
          onDrop={(event) => {
            void handleDrop(event as DragEvent<HTMLDivElement>);
          }}
        >
          {currentMeta ? (
            <>
              <div className="track-header">
                <div>
                  <p className="eyebrow">Current audio</p>
                  <h2>{currentMeta.fileName}</h2>
                </div>
                <div className="meta-grid">
                  <span>{formatBytes(currentMeta.fileSize)}</span>
                  <span>{formatTime(state.durationSec)}</span>
                  <span>{currentMeta.sampleRate} Hz</span>
                  <span>{currentMeta.channels} ch</span>
                </div>
              </div>

              <div className="waveform-card">
                <WaveformCanvas
                  currentTimeSec={state.currentTimeSec}
                  durationSec={state.durationSec}
                  points={state.waveform}
                  view={view}
                  windowStartSec={state.waveformWindowStartSec}
                  windowEndSec={state.waveformWindowEndSec || state.durationSec}
                  onSeek={(timeSec) => {
                    void handleSeek(timeSec);
                  }}
                />
                <div className="transport">
                  <button type="button" className="button" onClick={() => void togglePlayback()}>
                    {state.isPlaying ? "Pause" : "Play"}
                  </button>
                  <button type="button" className="ghost-button" onClick={() => void handleSeek(0)}>
                    Restart
                  </button>
                  <input
                    className="seek-bar"
                    type="range"
                    min="0"
                    max={Math.max(state.durationSec, 0)}
                    step="0.1"
                    value={Math.min(state.currentTimeSec, state.durationSec)}
                    onChange={(event) => {
                      void handleSeek(Number(event.target.value));
                    }}
                  />
                  <span>
                    {formatTime(state.currentTimeSec)} / {formatTime(state.durationSec)}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <p className="eyebrow">No file loaded</p>
              <h2>Drop a WAV or MP3 file here.</h2>
              <p className="muted">
                First release targets very large local files by prioritizing playback and
                generating the waveform overview asynchronously.
              </p>
              <p className="muted">
                In the desktop shell, the system file dialog is the safest path for guaranteed
                native file access on very large files.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
