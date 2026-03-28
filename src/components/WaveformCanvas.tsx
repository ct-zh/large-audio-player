import { useEffect, useMemo, useRef } from "react";
import type { WaveformPoint, WaveformView } from "../types";

interface WaveformCanvasProps {
  currentTimeSec: number;
  durationSec: number;
  points: WaveformPoint[];
  view: WaveformView;
  onSeek: (timeSec: number) => void;
}

const colorsByScheme = {
  ocean: {
    stroke: "#72f1b8",
    fill: "rgba(54, 96, 100, 0.35)",
    progress: "#f9fb76",
    grid: "rgba(255,255,255,0.08)"
  },
  sunset: {
    stroke: "#ffb26b",
    fill: "rgba(139, 60, 37, 0.3)",
    progress: "#fff7c2",
    grid: "rgba(255,255,255,0.08)"
  },
  mono: {
    stroke: "#d7dedc",
    fill: "rgba(110, 122, 125, 0.25)",
    progress: "#ffffff",
    grid: "rgba(255,255,255,0.08)"
  }
} as const;

export function WaveformCanvas({
  currentTimeSec,
  durationSec,
  points,
  view,
  onSeek
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const palette = useMemo(() => colorsByScheme[view.colorScheme], [view.colorScheme]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;

    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.scale(dpr, dpr);
    context.clearRect(0, 0, cssWidth, cssHeight);
    context.fillStyle = "rgba(8, 19, 24, 1)";
    context.fillRect(0, 0, cssWidth, cssHeight);

    const midY = cssHeight / 2;
    const barWidth = Math.max(1, view.zoom * 1.4);
    const totalWidth = points.length * barWidth;
    const visibleCount = Math.max(1, Math.ceil(cssWidth / barWidth));
    const progressRatio = durationSec > 0 ? currentTimeSec / durationSec : 0;
    const progressX = cssWidth * progressRatio;
    const amplitudeScale = (cssHeight * 0.42) * view.amplitude;
    const offsetRatio = Math.max(0, progressRatio - 0.45);
    const startIndex = Math.min(
      Math.max(0, Math.floor(offsetRatio * points.length)),
      Math.max(0, points.length - visibleCount)
    );

    context.strokeStyle = palette.grid;
    context.lineWidth = 1;

    for (let x = 0; x <= cssWidth; x += 120) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, cssHeight);
      context.stroke();
    }

    context.fillStyle = palette.fill;
    context.strokeStyle = palette.stroke;
    context.lineWidth = 1.2;

    for (let localIndex = 0; localIndex < visibleCount; localIndex += 1) {
      const point = points[startIndex + localIndex];

      if (!point) {
        break;
      }

      const x = localIndex * barWidth;
      const top = midY - point.max * amplitudeScale;
      const bottom = midY - point.min * amplitudeScale;
      const height = Math.max(1.5, bottom - top);

      context.fillRect(x, top, Math.max(1, barWidth - 1), height);
    }

    context.strokeStyle = palette.progress;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(progressX, 0);
    context.lineTo(progressX, cssHeight);
    context.stroke();

    context.fillStyle = palette.progress;
    context.font = "12px monospace";
    context.fillText(
      `${Math.round(totalWidth / Math.max(cssWidth, 1))}x data span`,
      16,
      20
    );
  }, [currentTimeSec, durationSec, palette, points, view]);

  return (
    <canvas
      ref={canvasRef}
      className="waveform-canvas"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        onSeek(ratio * durationSec);
      }}
    />
  );
}
