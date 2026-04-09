import { useEffect, useMemo, useRef, useState } from "react";
import type { WaveformPoint, WaveformView } from "../types";

interface WaveformCanvasProps {
  currentTimeSec: number;
  durationSec: number;
  points: WaveformPoint[];
  view: WaveformView;
  windowStartSec: number;
  windowEndSec: number;
  onHoverTimeChange?: (timeSec: number | null) => void;
  onSeek: (timeSec: number) => void;
}

const colorsByScheme = {
  ocean: {
    background: "#0d1a27",
    stroke: "#bcffe2",
    fill: "#7cecc5",
    glow: "rgba(124, 236, 197, 0.34)",
    progress: "#ffe07e",
    hover: "#ffd2dc",
    grid: "rgba(255,255,255,0.12)",
    label: "#edf8ff"
  },
  sunset: {
    background: "#231726",
    stroke: "#ffd9a6",
    fill: "#ffb07c",
    glow: "rgba(255, 176, 124, 0.32)",
    progress: "#fff2a7",
    hover: "#ffd6e2",
    grid: "rgba(255,255,255,0.12)",
    label: "#fff6f0"
  },
  mono: {
    background: "#18202a",
    stroke: "#f3f7fb",
    fill: "#d9e7f2",
    glow: "rgba(217, 231, 242, 0.3)",
    progress: "#fff5bc",
    hover: "#cfe7ff",
    grid: "rgba(255,255,255,0.12)",
    label: "#f5fbff"
  }
} as const;

const formatHoverTime = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remain = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
};

export function WaveformCanvas({
  currentTimeSec,
  durationSec,
  points,
  view,
  windowStartSec,
  windowEndSec,
  onHoverTimeChange,
  onSeek
}: WaveformCanvasProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastManualScrollAtRef = useRef(0);
  const lastAutoScrollAtRef = useRef(0);
  const [hoverState, setHoverState] = useState<{ x: number; timeSec: number } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const palette = useMemo(() => colorsByScheme[view.colorScheme], [view.colorScheme]);

  const cssHeight = 390;
  const baseViewportWidth = Math.max(640, viewportWidth || 0);
  const contentWidth = Math.max(baseViewportWidth, Math.ceil(baseViewportWidth * Math.max(view.zoom, 1)));
  const barWidth = points.length > 0 ? contentWidth / points.length : contentWidth;
  const contentSpanSec = Math.max(
    0.001,
    windowEndSec > windowStartSec ? windowEndSec - windowStartSec : durationSec
  );
  const isWindowed = windowEndSec > windowStartSec && contentSpanSec < Math.max(durationSec, 0.001);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const updateViewportWidth = () => {
      setViewportWidth(viewport.clientWidth);
    };

    updateViewportWidth();

    const observer = new ResizeObserver(() => {
      updateViewportWidth();
    });

    observer.observe(viewport);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const displayWidth = contentWidth;
    canvas.width = Math.floor(displayWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, displayWidth, cssHeight);
    context.fillStyle = palette.background;
    context.fillRect(0, 0, displayWidth, cssHeight);

    const midY = cssHeight / 2;
    const amplitudeScale = (cssHeight * 0.43) * view.amplitude;
    const gridStep = Math.max(120, Math.round(180 / Math.max(view.zoom, 0.8)));

    context.strokeStyle = palette.grid;
    context.lineWidth = 1;

    for (let x = 0; x <= displayWidth; x += gridStep) {
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, cssHeight);
      context.stroke();
    }

    context.beginPath();
    context.moveTo(0, midY + 0.5);
    context.lineTo(displayWidth, midY + 0.5);
    context.stroke();

    context.fillStyle = palette.fill;
    context.shadowColor = palette.glow;
    context.shadowBlur = 10;

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const x = index * barWidth;
      const top = midY - point.max * amplitudeScale;
      const bottom = midY - point.min * amplitudeScale;
      const height = Math.max(2, bottom - top);
      const drawWidth = Math.max(1, barWidth - 1);

      context.fillRect(x, top, drawWidth, height);
    }

    context.shadowBlur = 0;

    const progressRatio = isWindowed
      ? Math.max(0, Math.min(1, (currentTimeSec - windowStartSec) / contentSpanSec))
      : durationSec > 0
        ? Math.max(0, Math.min(1, currentTimeSec / durationSec))
        : 0;
    const progressX = displayWidth * progressRatio;

    context.strokeStyle = palette.progress;
    context.lineWidth = 2.5;
    context.beginPath();
    context.moveTo(progressX, 0);
    context.lineTo(progressX, cssHeight);
    context.stroke();

    context.fillStyle = palette.label;
    context.font = "12px monospace";
    context.fillText(`${Math.round(contentWidth / 960 * 10) / 10}x`, 16, 20);

    if (hoverState) {
      context.strokeStyle = palette.hover;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(hoverState.x, 0);
      context.lineTo(hoverState.x, cssHeight);
      context.stroke();
    }
  }, [
    barWidth,
    contentSpanSec,
    contentWidth,
    cssHeight,
    currentTimeSec,
    durationSec,
    hoverState,
    isWindowed,
    palette,
    points,
    view.amplitude
  ]);

  useEffect(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const now = Date.now();
    if (now - lastManualScrollAtRef.current < 1200) {
      return;
    }

    const progressRatio = isWindowed
      ? Math.max(0, Math.min(1, (currentTimeSec - windowStartSec) / contentSpanSec))
      : durationSec > 0
        ? Math.max(0, Math.min(1, currentTimeSec / durationSec))
        : 0;
    const progressX = contentWidth * progressRatio;
    const visibleStart = viewport.scrollLeft;
    const visibleEnd = visibleStart + viewport.clientWidth;
    const leftThreshold = visibleStart + viewport.clientWidth * 0.2;
    const rightThreshold = visibleEnd - viewport.clientWidth * 0.2;

    if (progressX < leftThreshold || progressX > rightThreshold) {
      const centered = Math.max(
        0,
        Math.min(contentWidth - viewport.clientWidth, progressX - viewport.clientWidth * 0.35)
      );
      lastAutoScrollAtRef.current = Date.now();
      viewport.scrollTo({ left: centered, behavior: "smooth" });
    }
  }, [contentSpanSec, contentWidth, currentTimeSec, durationSec, isWindowed, windowStartSec]);

  const resolveTimeFromViewportEvent = (clientX: number) => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return 0;
    }

    const rect = viewport.getBoundingClientRect();
    const x = viewport.scrollLeft + (clientX - rect.left);
    const ratio = Math.max(0, Math.min(1, x / Math.max(contentWidth, 1)));

    if (isWindowed) {
      return windowStartSec + ratio * contentSpanSec;
    }

    return ratio * durationSec;
  };

  return (
    <div className="waveform-shell">
      <div
        ref={viewportRef}
        className="waveform-viewport"
        onScroll={(event) => {
          if (Date.now() - lastAutoScrollAtRef.current < 300) {
            return;
          }

          if (!event.currentTarget.matches(":hover")) {
            return;
          }

          lastManualScrollAtRef.current = Date.now();
        }}
        onPointerMove={(event) => {
          const viewport = viewportRef.current;

          if (!viewport) {
            return;
          }

          const rect = viewport.getBoundingClientRect();
          const localX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
          const timeSec = resolveTimeFromViewportEvent(event.clientX);
          setHoverState({ x: viewport.scrollLeft + localX, timeSec });
          onHoverTimeChange?.(timeSec);
        }}
        onPointerLeave={() => {
          setHoverState(null);
          onHoverTimeChange?.(null);
        }}
        onClick={(event) => {
          onSeek(resolveTimeFromViewportEvent(event.clientX));
        }}
      >
        <canvas ref={canvasRef} className="waveform-canvas" />
      </div>
      {hoverState ? (
        <div
          className="waveform-hover-tag"
          style={{
            left: Math.max(14, Math.min((hoverState.x - (viewportRef.current?.scrollLeft ?? 0)) + 14, (viewportRef.current?.clientWidth ?? 0) - 72))
          }}
        >
          {formatHoverTime(hoverState.timeSec)}
        </div>
      ) : null}
    </div>
  );
}
