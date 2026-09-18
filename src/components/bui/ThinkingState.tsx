/**
 * ThinkingState — expandable agent trace (working → staggered reveal → settle).
 *
 * adapted from beautifului.dev (MIT) — https://www.beautifului.dev
 * ("THINKING — expandable agent trace" primitive).
 *
 * Preserved from the source primitive:
 *   - `useSequence(STAGES)` intro orchestration: header first, auto-expand,
 *     then trace rows fade up with a staggered per-row delay;
 *   - `manualExpanded` override: the user's click always wins over the auto
 *     choreography until they click again (three-state null/true/false);
 *   - `onSettled` fires exactly once when the trace leaves its working phase
 *     (lets embedders sequence content after the settle);
 *   - Steps / Reasoning variants, shimmer active label, hairline trace guide
 *     with measured height, and the grid-template-rows expand/collapse.
 *
 * Adapted for herdr (V10 PRD F2 — real data, no demo content):
 *   - `rows` / `active` / `done` come from the caller (parsed tool-block
 *     summaries, elapsed label); the source's built-in demo rows are gone;
 *   - the settle transition is prop-driven (`settled`, wired to the turn's
 *     duration meta) instead of running on the demo timer;
 *   - Search / Coding variants are dropped: herdr data carries no
 *     search-result or diff semantics;
 *   - Tailwind classes are translated to the project's --chat-* tokens;
 *   - the V9 live-row contract testids are carried by this component:
 *     `thinking-live` on the root, `thinking-spinner` on the working spinner.
 *
 * V10 任务B 过程行规范化:
 *   - the working label is a single line: `思考中` + a pure-CSS animated
 *     dots wave (opacity only) + the elapsed seconds — the captured raw
 *     process text (`trace` prop) is NEVER auto-shown while working;
 *   - `trace` present ⇒ the auto-expand choreography is suppressed (the
 *     row stays one line); a user click expands the trace and reveals the
 *     captured process text under the tool rows.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Stage cadence of the intro choreography (ms per stage transition). */
const STAGES = [800, 600, 1400];
/** Real trace shows at most the last MAX_ROWS tool rows (PRD: 最近 3-5 条). */
const MAX_ROWS = 4;

function useSequence(steps: number[]) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (stage >= steps.length - 1) return;
    const t = setTimeout(() => setStage((s) => s + 1), steps[stage]);
    return () => clearTimeout(t);
  }, [stage, steps]);
  return stage;
}

/** Elapsed primitive: whole seconds since mount, 1s private heartbeat. */
function useElapsedSeconds() {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setSec((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return sec;
}

export type ThinkingRow = {
  primary: string;
  secondary?: string;
  mono?: boolean;
  add?: number;
  del?: number;
};

type VariantId = "Steps" | "Reasoning";

const VARIANTS: Record<VariantId, { active: string; done: string }> = {
  Steps: { active: "思考中", done: "Thought for 4 seconds" },
  Reasoning: { active: "思考中", done: "Thought for 4 seconds" },
};

export default function ThinkingState({
  variant = "Steps",
  rows = [],
  active,
  done,
  settled = false,
  trace,
  onSettled,
}: {
  variant?: VariantId;
  /** real trace rows — herdr tool-block summaries (最近几条) */
  rows?: ThinkingRow[];
  /** working label; the live elapsed seconds are appended ("思考中 3s") */
  active?: string;
  /** settled label, e.g. "Thought for 28s" (turn duration meta) */
  done?: string;
  /** true when the turn's duration meta arrived — settles the trace */
  settled?: boolean;
  /** captured raw process text (V10 任务B). Never auto-shown: while set the
   *  row stays a single line and the text is only revealed by a user click. */
  trace?: string;
  /** fired once when the trace leaves its working phase */
  onSettled?: () => void;
}) {
  const stage = useSequence(STAGES);
  const elapsed = useElapsedSeconds();
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const base = VARIANTS[variant] ?? VARIANTS.Steps;
  const working = !settled;

  /* let embedders sequence content after the trace settles */
  const settledRef = useRef(false);
  useEffect(() => {
    if (working || settledRef.current) return;
    settledRef.current = true;
    onSettled?.();
  }, [working, onSettled]);

  const visibleRows = rows.slice(-MAX_ROWS);
  // Auto choreography: stay a single spinner row until the intro passed AND
  // there is something to trace; with no rows yet the header alone carries
  // the live "single-line spinner" semantics (V9 F6 contract). V10 任务B:
  // captured process text (`trace`) suppresses the auto-expand — the row
  // must stay ONE line while working; only the user's click reveals it.
  const autoExpanded = working && stage >= 1 && visibleRows.length > 0 && !trace;
  const expanded = manualExpanded ?? autoExpanded;
  const shown = settled || stage >= 1 ? visibleRows.length : 0;

  // V10 任务B: live label = `思考中` + animated dots + elapsed seconds (the
  // dots replace the old bare "…" placeholder; pure CSS opacity wave).
  const activeLabel = active ?? base.active;
  const doneLabel = done ?? base.done;

  const traceRef = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(0);
  useLayoutEffect(() => {
    if (traceRef.current) setLineHeight(traceRef.current.offsetHeight);
  }, [shown, expanded, variant, stage, trace]);

  return (
    <div className="bui-thinking" data-testid="thinking-live" title="Agent 正在思考 — 实时 trace">
      {/* header */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded((current) => !(current ?? autoExpanded))}
        className="bui-thinking-head"
      >
        {working ? (
          <span className="bui-thinking-spinner" data-testid="thinking-spinner" aria-hidden />
        ) : (
          <svg className="bui-thinking-glyph" width="14" height="14" viewBox="0 0 24 24" fill="var(--chat-dim)" aria-hidden>
            <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
          </svg>
        )}
        <span role="status" className="bui-thinking-label">
          {working ? (
            <>
              <span className="bui-shimmer-text">
                {activeLabel}
                <span className="bui-dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
              </span>
              {elapsed >= 1 && <span className="bui-thinking-elapsed">{elapsed}s</span>}
            </>
          ) : (
            <span className="bui-thinking-done">{doneLabel}</span>
          )}
        </span>
        <svg
          className={`bui-thinking-chevron${expanded ? " open" : ""}`}
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--chat-dim)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* expandable trace */}
      <div
        className="bui-collapse"
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr", opacity: expanded ? 1 : 0 }}
      >
        <div className="bui-collapse-clip">
          <div className="bui-trace">
            <span
              aria-hidden
              className="bui-trace-guide"
              style={{ height: lineHeight ? lineHeight - 2 : 0 }}
            />
            <div ref={traceRef} className="bui-trace-rows">
              {visibleRows.slice(0, shown).map((row, i) => {
                const rowDone = i < shown - 1 || !working;
                return (
                  <div
                    key={`${row.primary}-${i}`}
                    className={`bui-trace-row${variant === "Reasoning" ? " reasoning" : ""}`}
                    style={{ animationDelay: `${i * 120}ms` }}
                  >
                    {variant === "Steps" &&
                      (rowDone ? (
                        <svg
                          className="bui-trace-check"
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--chat-dim)"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      ) : (
                        <span className="bui-row-spinner" aria-hidden />
                      ))}
                    <span className="bui-trace-primary">{row.primary}</span>
                    {row.secondary && (
                      <span className={`bui-trace-secondary${row.mono ? " mono" : ""}`}>{row.secondary}</span>
                    )}
                    {row.add !== undefined && (
                      <span className="bui-trace-diff">
                        <span className="add">+{row.add}</span> <span className="del">−{row.del ?? 0}</span>
                      </span>
                    )}
                  </div>
                );
              })}
              {/* V10 任务B: captured raw process text — mounted ONLY when the
                 user expanded the row (auto-expand is suppressed while
                 `trace` is set), so a collapsed row never carries the text
                 in the DOM at all; pre-wrap keeps the captured lines as-is. */}
              {trace && expanded && (
                <div className="bui-trace-row reasoning process">
                  <span className="bui-trace-primary">{trace}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
