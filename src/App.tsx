import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "./lib/tauriBridge";
import { WaveformCanvas } from "./components/WaveformCanvas";
import type {
  AudioMeta,
  DspPresetId,
  DspSettings,
  EqSettings,
  NoiseReductionAmount,
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

const offDspPreset: DspSettings = {
  inputGainDb: 0,
  highPassHz: 70,
  lowPassHz: 8_000,
  footstepPresenceDb: 0,
  speechPresenceDb: 0,
  noiseReductionAmount: "off",
  noiseFocusHz: 3_500,
  expanderThresholdDb: -42,
  expanderRatio: 1.5,
  expanderAttackMs: 20,
  expanderReleaseMs: 240,
  outputGainDb: 0
};

const upstairsVoiceFootstepsPreset: DspSettings = {
  inputGainDb: 0,
  highPassHz: 70,
  lowPassHz: 8_000,
  footstepPresenceDb: 4,
  speechPresenceDb: 3,
  noiseReductionAmount: "low",
  noiseFocusHz: 3_500,
  expanderThresholdDb: -42,
  expanderRatio: 1.5,
  expanderAttackMs: 20,
  expanderReleaseMs: 240,
  outputGainDb: 1
};

const dspPresets: Record<Exclude<DspPresetId, "custom">, DspSettings> = {
  off: offDspPreset,
  upstairs_voice_footsteps: upstairsVoiceFootstepsPreset
};

const initialState: PlayerState = {
  phase: "idle",
  errorMessage: null,
  audioMeta: null,
  waveform: [],
  waveformProgress: 0,
  gain: 1,
  playbackRate: 1,
  eq: defaultEq,
  dspPresetId: "off",
  dsp: offDspPreset,
  isAdvancedDspOpen: false,
  currentTimeSec: 0,
  durationSec: 0,
  isPlaying: false,
  waveformWindowStartSec: 0,
  waveformWindowEndSec: 0
};

type Locale = "zh-CN" | "en-US";

const contentByLocale = {
  "zh-CN": {
    localeLabel: "中文",
    productName: "大文件音频播放器",
    heroTitle: "像摆弄糖果色旋钮一样，轻松操控超大音频文件。",
    heroDescription: "支持本地 WAV / MP3 打开、播放、调参与波形查看。",
    statusLoading: "正在准备播放并生成波形预览",
    statusIdle: "拖入本地 WAV / MP3 文件开始播放",
    statusReady: "播放器已经就绪",
    statusErrorFallback: "发生未知错误",
    statusWaveform: "波形概览 {value}%",
    languageTitle: "语言模式",
    languageDescription: "切换界面语言。",
    importPanelTitle: "导入音频",
    importPanelDescription: "选择或拖入本地音频文件。",
    chooseAudio: "选择音频文件",
    openSystemDialog: "使用系统对话框",
    dragHint: "也可以直接把文件拖到右侧播放器区域。",
    chainPanelTitle: "音频链路",
    chainPanelDescription: "调整增益与三段 EQ。",
    gain: "音量",
    low: "低频",
    mid: "中频",
    high: "高频",
    waveformPanelTitle: "波形外观",
    waveformPanelDescription: "调整波形视图参数。",
    zoom: "缩放",
    amplitude: "振幅",
    palette: "配色",
    paletteOcean: "薄荷海盐",
    paletteSunset: "奶桃晚霞",
    paletteMono: "云雾牛奶",
    nowPlaying: "当前文件",
    playerBadge: "固定播放器舞台",
    playerSummary: "显示波形、时间线和播放控制。",
    emptyEyebrow: "尚未载入文件",
    emptyTitle: "把 WAV 或 MP3 放进这块糖果色舞台。",
    emptyDescription: "拖入或选择一个本地 WAV / MP3 文件开始使用。",
    emptyDescriptionSecondary: "桌面环境下也可以使用系统文件对话框打开音频。",
    dropTitle: "松手即可打开音频",
    fileSize: "文件大小",
    duration: "总时长",
    sampleRate: "采样率",
    channels: "声道",
    play: "播放",
    pause: "暂停",
    restart: "从头播放",
    speed: "倍速",
    dspPresetTitle: "处理预设",
    dspPresetDescription: "选择保守的监听处理方案。",
    dspPresetOff: "关闭",
    dspPresetUpstairs: "楼上脚步声 / 说话声录音",
    dspPresetCustom: "自定义",
    dspBasicTitle: "基础处理",
    dspBasicDescription: "控制高通、低通、目标增强和轻度抑噪。",
    dspAdvancedTitle: "高级处理",
    dspAdvancedDescription: "扩展器与噪声重点频率。",
    inputGain: "输入增益",
    highPass: "高通",
    lowPass: "低通",
    footstepPresence: "动作声增强",
    speechPresence: "人声增强",
    noiseReduction: "底噪抑制",
    noiseFocus: "噪声重点频率",
    outputGain: "输出增益",
    expanderThreshold: "扩展器阈值",
    expanderRatio: "扩展器比率",
    expanderAttack: "扩展器起效",
    expanderRelease: "扩展器释放",
    noiseReductionOff: "关闭",
    noiseReductionLow: "低",
    noiseReductionMedium: "中",
    applyDsp: "应用",
    resetDspDraft: "恢复已应用",
    pendingDsp: "参数未应用",
    showAdvanced: "显示高级参数",
    hideAdvanced: "收起高级参数",
    progressLabel: "播放进度",
    hoverTime: "悬停时间",
    metadataHz: "Hz",
    metadataChannels: "声",
    progressCard: "波形已就绪",
    progressCardPending: "正在生成波形",
    onlySupported: "当前版本仅支持 .wav 与 .mp3 文件。",
    loadFailed: "加载音频失败。"
  },
  "en-US": {
    localeLabel: "EN",
    productName: "Large Audio Player",
    heroTitle: "Handle oversized audio like a tray of pastel knobs and candy switches.",
    heroDescription: "Open local WAV / MP3 files for playback, tuning, and waveform viewing.",
    statusLoading: "Preparing playback and building the waveform preview",
    statusIdle: "Drop a local WAV or MP3 file to begin",
    statusReady: "Player ready",
    statusErrorFallback: "Unknown error",
    statusWaveform: "Waveform overview {value}%",
    languageTitle: "Language",
    languageDescription: "Switch the interface language.",
    importPanelTitle: "Import Audio",
    importPanelDescription: "Choose or drop a local audio file.",
    chooseAudio: "Choose audio",
    openSystemDialog: "Open native dialog",
    dragHint: "You can also drop a file directly onto the player stage.",
    chainPanelTitle: "Audio Chain",
    chainPanelDescription: "Adjust gain and three-band EQ.",
    gain: "Volume",
    low: "Low",
    mid: "Mid",
    high: "High",
    waveformPanelTitle: "Waveform View",
    waveformPanelDescription: "Adjust waveform view settings.",
    zoom: "Zoom",
    amplitude: "Amplitude",
    palette: "Palette",
    paletteOcean: "Mint Tide",
    paletteSunset: "Peach Glow",
    paletteMono: "Milk Fog",
    nowPlaying: "Now Playing",
    playerBadge: "Pinned Player Stage",
    playerSummary: "Shows waveform, timeline, and transport controls.",
    emptyEyebrow: "No file loaded",
    emptyTitle: "Drop a WAV or MP3 into this pastel stage.",
    emptyDescription: "Drop or choose a local WAV or MP3 file to begin.",
    emptyDescriptionSecondary: "Desktop mode can also open audio from the native file dialog.",
    dropTitle: "Release to open audio",
    fileSize: "File Size",
    duration: "Duration",
    sampleRate: "Sample Rate",
    channels: "Channels",
    play: "Play",
    pause: "Pause",
    restart: "Restart",
    speed: "Speed",
    dspPresetTitle: "Processing Preset",
    dspPresetDescription: "Choose a conservative monitoring profile.",
    dspPresetOff: "Off",
    dspPresetUpstairs: "Upstairs footsteps / speech",
    dspPresetCustom: "Custom",
    dspBasicTitle: "Basic Processing",
    dspBasicDescription: "Control filters, target boosts, and gentle noise reduction.",
    dspAdvancedTitle: "Advanced Processing",
    dspAdvancedDescription: "Expander tuning and noise focus frequency.",
    inputGain: "Input Gain",
    highPass: "High-pass",
    lowPass: "Low-pass",
    footstepPresence: "Footstep Boost",
    speechPresence: "Speech Boost",
    noiseReduction: "Noise Reduction",
    noiseFocus: "Noise Focus",
    outputGain: "Output Gain",
    expanderThreshold: "Expander Threshold",
    expanderRatio: "Expander Ratio",
    expanderAttack: "Expander Attack",
    expanderRelease: "Expander Release",
    noiseReductionOff: "Off",
    noiseReductionLow: "Low",
    noiseReductionMedium: "Medium",
    applyDsp: "Apply",
    resetDspDraft: "Reset to applied",
    pendingDsp: "Pending changes",
    showAdvanced: "Show advanced controls",
    hideAdvanced: "Hide advanced controls",
    progressLabel: "Playback progress",
    hoverTime: "Hover time",
    metadataHz: "Hz",
    metadataChannels: "ch",
    progressCard: "Waveform ready",
    progressCardPending: "Waveform in progress",
    onlySupported: "Only .wav and .mp3 files are supported in this version.",
    loadFailed: "Failed to load audio."
  }
} as const;

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

const cloneDspSettings = (settings: DspSettings): DspSettings => ({ ...settings });

const sameDspSettings = (left: DspSettings, right: DspSettings) =>
  left.inputGainDb === right.inputGainDb &&
  left.highPassHz === right.highPassHz &&
  left.lowPassHz === right.lowPassHz &&
  left.footstepPresenceDb === right.footstepPresenceDb &&
  left.speechPresenceDb === right.speechPresenceDb &&
  left.noiseReductionAmount === right.noiseReductionAmount &&
  left.noiseFocusHz === right.noiseFocusHz &&
  left.expanderThresholdDb === right.expanderThresholdDb &&
  left.expanderRatio === right.expanderRatio &&
  left.expanderAttackMs === right.expanderAttackMs &&
  left.expanderReleaseMs === right.expanderReleaseMs &&
  left.outputGainDb === right.outputGainDb;

const detectPresetId = (settings: DspSettings): DspPresetId => {
  if (sameDspSettings(settings, dspPresets.off)) {
    return "off";
  }

  if (sameDspSettings(settings, dspPresets.upstairs_voice_footsteps)) {
    return "upstairs_voice_footsteps";
  }

  return "custom";
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
  const [draftDsp, setDraftDsp] = useState<DspSettings>(cloneDspSettings(initialState.dsp));
  const [view, setView] = useState<WaveformView>(defaultWaveformView);
  const [locale, setLocale] = useState<Locale>("zh-CN");
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredWaveformTimeSec, setHoveredWaveformTimeSec] = useState<number | null>(null);
  const isDesktopTauri = bridge.isTauri();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const openRequestIdRef = useRef(0);
  const currentMeta = state.audioMeta;
  const copy = contentByLocale[locale];
  const draftDspPresetId = detectPresetId(draftDsp);
  const dspDirty = !sameDspSettings(draftDsp, state.dsp);

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
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!currentMeta) {
        return;
      }

      const target = event.target;
      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase();
        if (
          tagName === "input" ||
          tagName === "textarea" ||
          tagName === "select" ||
          tagName === "button" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        void handleSeek(state.currentTimeSec - 5);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        void handleSeek(state.currentTimeSec + 5);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentMeta, state.currentTimeSec, state.durationSec]);

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
      return copy.statusLoading;
    }

    if (state.phase === "error") {
      return state.errorMessage ?? copy.statusErrorFallback;
    }

    if (!currentMeta) {
      return copy.statusIdle;
    }

    if (state.waveformProgress < 1) {
      return copy.statusWaveform.replace("{value}", `${Math.round(state.waveformProgress * 100)}`);
    }

    return copy.statusReady;
  }, [copy, currentMeta, state.errorMessage, state.phase, state.waveformProgress]);

  const paletteOptions = [
    { value: "ocean" as const, label: copy.paletteOcean },
    { value: "sunset" as const, label: copy.paletteSunset },
    { value: "mono" as const, label: copy.paletteMono }
  ];
  const playbackRateOptions = [0.5, 1, 1.25, 1.5, 2];
  const dspPresetOptions: Array<{ value: Exclude<DspPresetId, "custom"> | "custom"; label: string }> = [
    { value: "off", label: copy.dspPresetOff },
    { value: "upstairs_voice_footsteps", label: copy.dspPresetUpstairs },
    { value: "custom", label: copy.dspPresetCustom }
  ];
  const noiseReductionOptions: Array<{ value: NoiseReductionAmount; label: string }> = [
    { value: "off", label: copy.noiseReductionOff },
    { value: "low", label: copy.noiseReductionLow },
    { value: "medium", label: copy.noiseReductionMedium }
  ];

  const applyFallbackDspToAudio = (settings: DspSettings) => {
    if (isDesktopTauri || !audioRef.current) {
      return;
    }

    const linearOutput = 10 ** (settings.outputGainDb / 20);
    audioRef.current.volume = Math.max(0, Math.min(1, linearOutput));
  };

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
    audioRef.current.playbackRate = initialState.playbackRate;
    applyFallbackDspToAudio(initialState.dsp);

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

  const loadAudio = async (source: { path: string; file?: File }) => {
    const loadId = openRequestIdRef.current + 1;
    openRequestIdRef.current = loadId;
    setHoveredWaveformTimeSec(null);

    await resetPlaybackSideEffects();

    if (openRequestIdRef.current !== loadId) {
      return;
    }

    setState({
      ...initialState,
      phase: "loading"
    });
    setDraftDsp(cloneDspSettings(initialState.dsp));

    try {
      const { audioMeta } = await bridge.openAudio(source.path, source.file);

      if (openRequestIdRef.current !== loadId) {
        return;
      }

      if (source.file) {
        await applyMetaToLocalAudio(source.file, audioMeta);

        if (openRequestIdRef.current !== loadId) {
          return;
        }
      } else {
        setState((prev) => ({
          ...prev,
          audioMeta,
          durationSec: audioMeta.durationSec,
          currentTimeSec: 0
        }));
      }

      const overview = await bridge.requestWaveformOverview(
        source.path,
        source.file,
        waveformTargetPoints(view.zoom),
        0,
        audioMeta.durationSec
      );

      if (openRequestIdRef.current !== loadId) {
        return;
      }

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
      if (openRequestIdRef.current !== loadId) {
        return;
      }

      setState((prev) => ({
        ...prev,
        phase: "error",
        errorMessage: error instanceof Error ? error.message : copy.loadFailed
      }));
    }
  };

  const handleFile = async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase();

    if (!extension || !["wav", "mp3"].includes(extension)) {
      setState((prev) => ({
        ...prev,
        phase: "error",
        errorMessage: copy.onlySupported
      }));
      return;
    }

    const nativePath = getDesktopFilePath(file);
    const requestPath = nativePath ?? file.name;
    await loadAudio({ path: requestPath, file });
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

  const applyDspSettings = async (nextSettings: DspSettings) => {
    const nextPresetId = detectPresetId(nextSettings);
    setState((prev) => ({
      ...prev,
      dsp: nextSettings,
      dspPresetId: nextPresetId,
      gain: 10 ** (nextSettings.outputGainDb / 20)
    }));
    applyFallbackDspToAudio(nextSettings);

    if (currentMeta) {
      await bridge.setDspSettings(nextSettings);
    }
  };

  const updateDspField = <K extends keyof DspSettings>(key: K, value: DspSettings[K]) => {
    setDraftDsp((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const applyDspPreset = (presetId: Exclude<DspPresetId, "custom">) => {
    setDraftDsp(cloneDspSettings(dspPresets[presetId]));
  };

  const resetDspDraft = () => {
    setDraftDsp(cloneDspSettings(state.dsp));
  };

  const updatePlaybackRate = async (playbackRate: number) => {
    setState((prev) => ({ ...prev, playbackRate }));
    await bridge.setPlaybackRate(playbackRate);

    if (!isDesktopTauri && audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  };

  return (
    <div className="app-shell" data-locale={locale}>
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

      <aside className="control-rail">
        <div className="rail-scroll">
          <section className="intro-card panel-card">
            <p className="eyebrow">{copy.productName}</p>
            <h1>{copy.heroTitle}</h1>
            <p className="supporting-copy">{copy.heroDescription}</p>
            <div className="status-banner">
              <span className={`status-dot status-${state.phase}`} />
              <span>{statusLabel}</span>
            </div>
          </section>

          <section className="panel-card locale-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{copy.languageTitle}</p>
                <h2>{copy.languageDescription}</h2>
              </div>
            </div>
            <div className="locale-switch">
              <button
                type="button"
                className={`locale-pill ${locale === "zh-CN" ? "active" : ""}`}
                onClick={() => {
                  setLocale("zh-CN");
                }}
              >
                中文
              </button>
              <button
                type="button"
                className={`locale-pill ${locale === "en-US" ? "active" : ""}`}
                onClick={() => {
                  setLocale("en-US");
                }}
              >
                English
              </button>
            </div>
          </section>

          <section className="panel-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{copy.importPanelTitle}</p>
                <h2>{copy.importPanelDescription}</h2>
              </div>
            </div>
            <label className="candy-button">
              {copy.chooseAudio}
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
                  await loadAudio({ path });
                }
              }}
            >
              {copy.openSystemDialog}
            </button>
            <p className="micro-copy">{copy.dragHint}</p>
          </section>

          <section className="panel-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{copy.dspPresetTitle}</p>
                <h2>{copy.dspPresetDescription}</h2>
              </div>
            </div>
            <div className="preset-pills">
              {dspPresetOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`preset-pill ${draftDspPresetId === option.value ? "active" : ""}`}
                  onClick={() => {
                    if (option.value !== "custom") {
                      applyDspPreset(option.value);
                    }
                  }}
                  disabled={option.value === "custom"}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="dsp-actions">
              <button
                type="button"
                className="candy-button compact-button"
                disabled={!dspDirty}
                onClick={() => {
                  void applyDspSettings(draftDsp);
                }}
              >
                {copy.applyDsp}
              </button>
              <button
                type="button"
                className="ghost-button compact-button"
                disabled={!dspDirty}
                onClick={resetDspDraft}
              >
                {copy.resetDspDraft}
              </button>
            </div>
            {dspDirty ? <p className="micro-copy pending-indicator">{copy.pendingDsp}</p> : null}
          </section>

          <section className="panel-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{copy.dspBasicTitle}</p>
                <h2>{copy.dspBasicDescription}</h2>
              </div>
            </div>
            <label className="slider-field">
              <span>{copy.inputGain} {draftDsp.inputGainDb.toFixed(1)} dB</span>
              <input
                type="range"
                min="-12"
                max="12"
                step="0.5"
                value={draftDsp.inputGainDb}
                onChange={(event) => {
                  updateDspField("inputGainDb", Number(event.target.value));
                }}
              />
            </label>
            <label className="slider-field">
              <span>{copy.highPass} {Math.round(draftDsp.highPassHz)} Hz</span>
              <input
                type="range"
                min="30"
                max="150"
                step="1"
                value={draftDsp.highPassHz}
                onChange={(event) => {
                  updateDspField("highPassHz", Number(event.target.value));
                }}
              />
            </label>
            <label className="slider-field">
              <span>{copy.lowPass} {Math.round(draftDsp.lowPassHz)} Hz</span>
              <input
                type="range"
                min="4000"
                max="12000"
                step="100"
                value={draftDsp.lowPassHz}
                onChange={(event) => {
                  updateDspField("lowPassHz", Number(event.target.value));
                }}
              />
            </label>
            <label className="slider-field">
              <span>{copy.footstepPresence} {draftDsp.footstepPresenceDb.toFixed(1)} dB</span>
              <input
                type="range"
                min="-6"
                max="9"
                step="0.5"
                value={draftDsp.footstepPresenceDb}
                onChange={(event) => {
                  updateDspField("footstepPresenceDb", Number(event.target.value));
                }}
              />
            </label>
            <label className="slider-field">
              <span>{copy.speechPresence} {draftDsp.speechPresenceDb.toFixed(1)} dB</span>
              <input
                type="range"
                min="-6"
                max="9"
                step="0.5"
                value={draftDsp.speechPresenceDb}
                onChange={(event) => {
                  updateDspField("speechPresenceDb", Number(event.target.value));
                }}
              />
            </label>
            <label className="select-field">
              <span>{copy.noiseReduction}</span>
              <select
                value={draftDsp.noiseReductionAmount}
                onChange={(event) => {
                  updateDspField(
                    "noiseReductionAmount",
                    event.target.value as NoiseReductionAmount
                  );
                }}
              >
                {noiseReductionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="slider-field">
              <span>{copy.outputGain} {draftDsp.outputGainDb.toFixed(1)} dB</span>
              <input
                type="range"
                min="-12"
                max="12"
                step="0.5"
                value={draftDsp.outputGainDb}
                onChange={(event) => {
                  updateDspField("outputGainDb", Number(event.target.value));
                }}
              />
            </label>
          </section>

          <section className="panel-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{copy.dspAdvancedTitle}</p>
                <h2>{copy.dspAdvancedDescription}</h2>
              </div>
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() => {
                  setState((prev) => ({
                    ...prev,
                    isAdvancedDspOpen: !prev.isAdvancedDspOpen
                  }));
                }}
              >
                {state.isAdvancedDspOpen ? copy.hideAdvanced : copy.showAdvanced}
              </button>
            </div>
            {state.isAdvancedDspOpen ? (
              <>
                <label className="slider-field">
                  <span>{copy.noiseFocus} {Math.round(draftDsp.noiseFocusHz)} Hz</span>
                  <input
                    type="range"
                    min="2000"
                    max="8000"
                    step="100"
                    value={draftDsp.noiseFocusHz}
                    onChange={(event) => {
                      updateDspField("noiseFocusHz", Number(event.target.value));
                    }}
                  />
                </label>
                <label className="slider-field">
                  <span>{copy.expanderThreshold} {draftDsp.expanderThresholdDb.toFixed(1)} dB</span>
                  <input
                    type="range"
                    min="-60"
                    max="-25"
                    step="0.5"
                    value={draftDsp.expanderThresholdDb}
                    onChange={(event) => {
                      updateDspField("expanderThresholdDb", Number(event.target.value));
                    }}
                  />
                </label>
                <label className="slider-field">
                  <span>{copy.expanderRatio} {draftDsp.expanderRatio.toFixed(2)}</span>
                  <input
                    type="range"
                    min="1"
                    max="3"
                    step="0.05"
                    value={draftDsp.expanderRatio}
                    onChange={(event) => {
                      updateDspField("expanderRatio", Number(event.target.value));
                    }}
                  />
                </label>
                <label className="slider-field">
                  <span>{copy.expanderAttack} {Math.round(draftDsp.expanderAttackMs)} ms</span>
                  <input
                    type="range"
                    min="5"
                    max="80"
                    step="1"
                    value={draftDsp.expanderAttackMs}
                    onChange={(event) => {
                      updateDspField("expanderAttackMs", Number(event.target.value));
                    }}
                  />
                </label>
                <label className="slider-field">
                  <span>{copy.expanderRelease} {Math.round(draftDsp.expanderReleaseMs)} ms</span>
                  <input
                    type="range"
                    min="80"
                    max="600"
                    step="5"
                    value={draftDsp.expanderReleaseMs}
                    onChange={(event) => {
                      updateDspField("expanderReleaseMs", Number(event.target.value));
                    }}
                  />
                </label>
              </>
            ) : null}
          </section>

          <section className="panel-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{copy.chainPanelTitle}</p>
                <h2>{copy.chainPanelDescription}</h2>
              </div>
            </div>
            <label className="slider-field">
              <span>{copy.low} {state.eq.low.toFixed(1)} dB</span>
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
            <label className="slider-field">
              <span>{copy.mid} {state.eq.mid.toFixed(1)} dB</span>
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
            <label className="slider-field">
              <span>{copy.high} {state.eq.high.toFixed(1)} dB</span>
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
          </section>

          <section className="panel-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{copy.waveformPanelTitle}</p>
                <h2>{copy.waveformPanelDescription}</h2>
              </div>
            </div>
            <label className="slider-field">
              <span>{copy.zoom} {view.zoom.toFixed(1)}x</span>
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
            <label className="slider-field">
              <span>{copy.amplitude} {view.amplitude.toFixed(1)}x</span>
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
            <label className="select-field">
              <span>{copy.palette}</span>
              <select
                value={view.colorScheme}
                onChange={(event) => {
                  setView((prev) => ({
                    ...prev,
                    colorScheme: event.target.value as WaveformView["colorScheme"]
                  }));
                }}
              >
                {paletteOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </section>

        </div>
      </aside>

      <main className="player-stage">
        <section
          className={`player-stage-shell ${isDragging ? "dragging" : ""}`}
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
          <div className="stage-orb orb-a" />
          <div className="stage-orb orb-b" />
          <div className="stage-orb orb-c" />

          <div className="player-stage-header">
            <div>
              <p className="eyebrow">{copy.playerBadge}</p>
              <h2>{copy.productName}</h2>
            </div>
            <p className="supporting-copy">{copy.playerSummary}</p>
          </div>

          {isDragging && (
            <div className="drop-overlay">
              <span>{copy.dropTitle}</span>
            </div>
          )}

          {currentMeta ? (
            <div className="player-stage-content">
              <div className="track-banner">
                <div>
                  <p className="eyebrow">{copy.nowPlaying}</p>
                  <h3>{currentMeta.fileName}</h3>
                </div>
                <div className="stage-progress-pill">
                  {state.waveformProgress >= 1 ? copy.progressCard : copy.progressCardPending}
                </div>
              </div>

              <div className="stat-grid">
                <div className="stat-card">
                  <span>{copy.fileSize}</span>
                  <strong>{formatBytes(currentMeta.fileSize)}</strong>
                </div>
                <div className="stat-card">
                  <span>{copy.duration}</span>
                  <strong>{formatTime(state.durationSec)}</strong>
                </div>
                <div className="stat-card">
                  <span>{copy.sampleRate}</span>
                  <strong>{currentMeta.sampleRate} {copy.metadataHz}</strong>
                </div>
                <div className="stat-card">
                  <span>{copy.channels}</span>
                  <strong>{currentMeta.channels} {copy.metadataChannels}</strong>
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
                  onHoverTimeChange={setHoveredWaveformTimeSec}
                  onSeek={(timeSec) => {
                    void handleSeek(timeSec);
                  }}
                />

                <div className="transport">
                  <button
                    type="button"
                    className="candy-button transport-button"
                    onClick={() => void togglePlayback()}
                  >
                    {state.isPlaying ? copy.pause : copy.play}
                  </button>
                  <button
                    type="button"
                    className="ghost-button transport-button"
                    onClick={() => void handleSeek(0)}
                  >
                    {copy.restart}
                  </button>
                  <div className="speed-control" role="group" aria-label={copy.speed}>
                    <span>{copy.speed}</span>
                    <div className="speed-pills">
                      {playbackRateOptions.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={`speed-pill ${state.playbackRate === option ? "active" : ""}`}
                          onClick={() => {
                            void updatePlaybackRate(option);
                          }}
                        >
                          {option}x
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="timeline-block">
                    <span>{copy.progressLabel}</span>
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
                  </label>
                  <div className="transport-meta">
                    <div className="transport-time">
                      {formatTime(state.currentTimeSec)} / {formatTime(state.durationSec)}
                    </div>
                    <div className="hover-time">
                      {copy.hoverTime}:{" "}
                      {hoveredWaveformTimeSec === null
                        ? "--:--"
                        : formatTime(hoveredWaveformTimeSec)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-stage-card">
              <p className="eyebrow">{copy.emptyEyebrow}</p>
              <h3>{copy.emptyTitle}</h3>
              <p className="supporting-copy">{copy.emptyDescription}</p>
              <p className="supporting-copy">{copy.emptyDescriptionSecondary}</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
