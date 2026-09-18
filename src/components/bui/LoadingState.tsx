/**
 * LoadingState — pixel-grid loader for long-running work.
 *
 * adapted from beautifului.dev (MIT) — https://www.beautifului.dev
 * ("LOADING STATE — pixel-grid loader" primitive).
 *
 * Preserved from the source primitive:
 *   - the LoaderGrid wavefront patterns: Drive (square cells, chevron
 *     wavefront with two fronts always in flight), Dots (circular cells),
 *     Orbit (a comet lapping the grid perimeter);
 *   - the shimmering label and the live elapsed timer (useElapsed — tick
 *     adapted to 1s per the V10 PRD);
 *   - reduced-motion friendliness: pixels freeze to their dim state, the
 *     timer still ticks (see the global.css media query).
 *
 * Removed: the Surfer variant — its demo video is pulled from an external
 * blob host, which violates this project's zero-external-request rule.
 */

import { useEffect, useState } from "react";

const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3),
    c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

const PATTERNS: Record<string, { delays: (number | null)[]; dur: number; round: boolean }> = {
  Drive: { delays: chevron, dur: 650, round: false },
  Dots: { delays: chevron, dur: 650, round: true },
  Orbit: { delays: orbit, dur: 950, round: false },
};

function useElapsed() {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setSec((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export default function LoadingState({
  label = "等待输出",
  variant = "Drive",
}: {
  label?: string;
  variant?: "Drive" | "Dots" | "Orbit";
}) {
  const elapsed = useElapsed();
  const { delays, dur, round } = PATTERNS[variant] ?? PATTERNS.Drive;

  return (
    <div role="status" data-testid="bui-loading" className="bui-loading">
      <span aria-hidden className="bui-loader-grid">
        {delays.map((delay, index) => (
          <span
            key={index}
            className={`bui-pixel${round ? " round" : ""}`}
            style={{
              opacity: delay === null ? 0.07 : 0.15,
              animation: delay === null ? "none" : `bui-pixel-on ${dur}ms ease-in-out ${delay}ms infinite`,
            }}
          />
        ))}
      </span>
      <span className="bui-shimmer-text">{label}</span>
      <span className="bui-loading-elapsed">{elapsed}</span>
    </div>
  );
}
