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

export type NoiseReductionAmount =
  | "off"
  | "low"
  | "medium";

export type DspPresetId =
  | "off"
  | "upstairs_voice_footsteps"
  | "custom";

export interface DspSettings {
  inputGainDb: number;
  highPassHz: number;
  lowPassHz: number;
  footstepPresenceDb: number;
  speechPresenceDb: number;
  noiseReductionAmount: NoiseReductionAmount;
  noiseFocusHz: number;
  expanderThresholdDb: number;
  expanderRatio: number;
  expanderAttackMs: number;
  expanderReleaseMs: number;
  outputGainDb: number;
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
  dspPresetId: DspPresetId;
  dsp: DspSettings;
  isAdvancedDspOpen: boolean;
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
