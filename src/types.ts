export type PlayerPhase =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export interface AudioMeta {
  path: string;
  fileName: string;
  fileSize: number;
  durationSec: number;
  sampleRate: number;
  channels: number;
}

export interface EqSettings {
  low: number;
  mid: number;
  high: number;
}

export interface WaveformView {
  zoom: number;
  amplitude: number;
  colorScheme: "ocean" | "sunset" | "mono";
}

export interface WaveformPoint {
  min: number;
  max: number;
}

export interface WaveformOverviewPayload {
  points: WaveformPoint[];
  progress: number;
  resolution: "overview" | "detail";
  windowStartSec: number;
  windowEndSec: number;
}

export interface PlayerState {
  phase: PlayerPhase;
  errorMessage: string | null;
  audioMeta: AudioMeta | null;
  waveform: WaveformPoint[];
  waveformProgress: number;
  gain: number;
  playbackRate: number;
  eq: EqSettings;
  currentTimeSec: number;
  durationSec: number;
  isPlaying: boolean;
  waveformWindowStartSec: number;
  waveformWindowEndSec: number;
}

export interface OpenAudioResult {
  audioMeta: AudioMeta;
}

export interface PlaybackStatus {
  positionSec: number;
  isPlaying: boolean;
}
