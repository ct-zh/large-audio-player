import type {
  DspSettings,
  EqSettings,
  OpenAudioResult,
  PlaybackStatus,
  WaveformOverviewPayload
} from "../types";

type Unlisten = () => void;

const isTauri = () =>
  Boolean(window.__TAURI__?.core?.invoke && window.__TAURI__?.event?.listen);

const mockDuration = (fileSize: number) => {
  const estimatedSeconds = Math.max(45, Math.min(60 * 60 * 3, fileSize / 180000));
  return Math.round(estimatedSeconds);
};

const generateMockWaveform = (seed: number, count: number) => {
  const points = [];
  let value = seed % 97;

  for (let index = 0; index < count; index += 1) {
    value = (value * 31 + 17) % 997;
    const peak = ((value % 65) + 25) / 100;
    points.push({
      min: -peak * (0.5 + ((index + seed) % 9) / 18),
      max: peak
    });
  }

  return points;
};

export const bridge = {
  isTauri,
  async openSystemAudioPicker(): Promise<string | null> {
    if (window.__TAURI__?.dialog?.open) {
      return window.__TAURI__.dialog.open({
        multiple: false,
        filters: [{ name: "Audio", extensions: ["wav", "mp3"] }]
      });
    }

    return null;
  },
  async openAudio(path: string, file?: File): Promise<OpenAudioResult> {
    if (isTauri()) {
      return window.__TAURI__!.core!.invoke<OpenAudioResult>("open_audio", { path });
    }

    const fileName = file?.name ?? path.split("/").pop() ?? "audio-file";
    const fileSize = file?.size ?? 0;

    return {
      audioMeta: {
        path,
        fileName,
        fileSize,
        durationSec: mockDuration(fileSize),
        sampleRate: 44100,
        channels: 2
      }
    };
  },
  async play(): Promise<void> {
    if (isTauri()) {
      await window.__TAURI__!.core!.invoke("play");
    }
  },
  async pause(): Promise<void> {
    if (isTauri()) {
      await window.__TAURI__!.core!.invoke("pause");
    }
  },
  async seek(positionSec: number): Promise<void> {
    if (isTauri()) {
      await window.__TAURI__!.core!.invoke("seek", { positionSec });
    }
  },
  async setGain(gain: number): Promise<void> {
    if (isTauri()) {
      await window.__TAURI__!.core!.invoke("set_gain", { gain });
    }
  },
  async setPlaybackRate(rate: number): Promise<void> {
    if (isTauri()) {
      await window.__TAURI__!.core!.invoke("set_playback_rate", { rate });
    }
  },
  async setDspSettings(settings: DspSettings): Promise<void> {
    if (isTauri()) {
      await window.__TAURI__!.core!.invoke("set_dsp_settings", { settings });
    }
  },
  async setEq(eq: EqSettings): Promise<void> {
    if (isTauri()) {
      await window.__TAURI__!.core!.invoke("set_eq", { eq });
    }
  },
  async getPlaybackStatus(): Promise<PlaybackStatus> {
    if (isTauri()) {
      return window.__TAURI__!.core!.invoke<PlaybackStatus>("get_playback_status");
    }

    return {
      positionSec: 0,
      isPlaying: false
    };
  },
  async requestWaveformOverview(
    path: string,
    file?: File,
    pointCount = 720,
    windowStartSec?: number,
    windowEndSec?: number
  ): Promise<WaveformOverviewPayload> {
    if (isTauri()) {
      return window.__TAURI__!.core!.invoke<WaveformOverviewPayload>(
        "request_waveform_overview",
        { path, pointCount, windowStartSec, windowEndSec }
      );
    }

    return {
      points: generateMockWaveform(file?.size ?? path.length, pointCount),
      progress: 1,
      resolution: pointCount > 720 ? "detail" : "overview",
      windowStartSec: windowStartSec ?? 0,
      windowEndSec: windowEndSec ?? mockDuration(file?.size ?? 0)
    };
  },
  async closeCurrentAudio(): Promise<void> {
    if (isTauri()) {
      await window.__TAURI__!.core!.invoke("close_current_audio");
    }
  },
  async onWaveformProgress(
    callback: (payload: WaveformOverviewPayload) => void
  ): Promise<Unlisten> {
    if (isTauri()) {
      return window.__TAURI__!.event!.listen<WaveformOverviewPayload>(
        "waveform_progress",
        (event) => callback(event.payload)
      );
    }

    return () => undefined;
  },
  async onWaveformReady(
    callback: (payload: WaveformOverviewPayload) => void
  ): Promise<Unlisten> {
    if (isTauri()) {
      return window.__TAURI__!.event!.listen<WaveformOverviewPayload>(
        "waveform_overview_ready",
        (event) => callback(event.payload)
      );
    }

    return () => undefined;
  },
  async onPlaybackStatus(
    callback: (payload: PlaybackStatus) => void
  ): Promise<Unlisten> {
    if (isTauri()) {
      return window.__TAURI__!.event!.listen<PlaybackStatus>(
        "playback_status",
        (event) => callback(event.payload)
      );
    }

    return () => undefined;
  }
};
