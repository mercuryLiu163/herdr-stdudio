/**
 * StreamingText — word-by-word reveal with a blinking cursor.
 *
 * adapted from beautifului.dev (MIT) — https://www.beautifului.dev
 * ("STREAMING TEXT" primitive).
 *
 * Preserved from the source primitive:
 *   - the StreamingToken[] {text, cite?} content model; `cite` tokens render
 *     an inline source chip (herdr has no citation data, so none are passed
 *     and the chip simply never renders);
 *   - the per-word reveal timer: a `count` cursor advanced WORD_MS at a
 *     time over the token array, with the trailing cursor span that
 *     disappears once the reveal has caught up;
 *   - loop semantics: `loop=true` restarts after HOLD_MS (demo galleries);
 *     `loop=false` — the real-thread mode — never restarts and fires
 *     `onDone` when the reveal reaches the end;
 *   - sources / followUps stay optional and render nothing when the caller
 *     has no such data (herdr: none).
 *
 * Adapted for herdr's 600ms polling (V10 PRD F1 — the F7 smoothness fix):
 *   - tokens derive from the live transcript via {@link tokenizeStreaming};
 *     the reveal count STARTS at the token total so history that already
 *     streamed before mount is never replayed, and only tokens that arrive
 *     AFTER mount animate in at WORD_MS each — the streaming cadence is
 *     decoupled from (and catches up with) the poll cadence;
 *   - whitespace is carried inside the tokens and the paragraph renders
 *     pre-wrap, so the joined tokens equal the source text exactly;
 *   - the source's demo-gallery furniture (fixed measure, action icons row)
 *     is dropped; the primitive fills the parent width (`fill`).
 */

import { useEffect, useRef, useState } from "react";

/** Per-token reveal cadence (ms). */
export const WORD_MS = 40;
/** Hold before a `loop=true` restart (source value kept). */
const HOLD_MS = 3400;

/** One streamed word/char, or a `cite` placeholder rendering an inline chip. */
export type StreamingToken = { text: string; cite?: boolean };

/** One cited source (optional; herdr passes none). */
export type StreamingSource = { name: string; domain: string; href: string; image: string };

/**
 * Split live transcript text into reveal tokens: whitespace runs stay whole,
 * CJK characters stream one per token, latin runs stream as words — so the
 * joined tokens reconstruct the source text exactly.
 */
export function tokenizeStreaming(text: string): StreamingToken[] {
  const out: StreamingToken[] = [];
  const re =
    /(\s+)|([\u4e00-\u9fff\u3000-\u303f\uff01-\uffef])|([^\s\u4e00-\u9fff\u3000-\u303f\uff01-\uffef]+)/g;
  for (const m of text.matchAll(re)) out.push({ text: m[0] });
  return out;
}

export default function StreamingText({
  content,
  sources = [],
  followUps = [],
  loop = false,
  fill = true,
  onDone,
  onFollowUp,
}: {
  /** the streamed tokens (derived from the live transcript) */
  content: StreamingToken[];
  /** cited sources shown as inline chips + list; empty → never rendered */
  sources?: StreamingSource[];
  /** follow-up prompts shown once the stream completes; empty → never rendered */
  followUps?: string[];
  /** restart the stream after a hold; must stay false in real threads */
  loop?: boolean;
  /** fill the parent width (the chat document flow) */
  fill?: boolean;
  onDone?: () => void;
  /** fired when a follow-up prompt is chosen */
  onFollowUp?: (text: string, index: number) => void;
}) {
  const tokens = content;
  // Polling adaptation: everything already received is pre-revealed — only
  // tokens arriving after mount animate in.
  const [count, setCount] = useState(() => tokens.length);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const done = count >= tokens.length;

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const caughtUpRef = useRef(true);
  // Wall-clock pacing anchor: `base` tokens were revealed at time `at`; the
  // reveal due-point advances at WORD_MS per token of REAL time. Each timer
  // firing reveals everything already due, so a throttled environment
  // (occluded Electron window → 1s timer clamp) catches up in one burst
  // instead of stalling, while an unthrottled one keeps the exact per-word
  // cadence.
  const paceRef = useRef<{ base: number; at: number } | null>(null);
  const countRef = useRef(count);
  countRef.current = count;
  useEffect(() => {
    if (done) {
      paceRef.current = null;
      if (loop) {
        const t = setTimeout(() => setCount(0), HOLD_MS);
        return () => clearTimeout(t);
      }
      // real-thread mode: fire onDone on the caught-up EDGE (a growing token
      // array can re-open the stream — each catch-up fires once)
      if (!caughtUpRef.current) {
        caughtUpRef.current = true;
        onDoneRef.current?.();
      }
      return;
    }
    caughtUpRef.current = false;
    if (!paceRef.current) paceRef.current = { base: countRef.current, at: performance.now() };
    const dueNow = () => {
      const pace = paceRef.current;
      if (!pace) return countRef.current;
      return Math.min(pace.base + Math.floor((performance.now() - pace.at) / WORD_MS), tokens.length);
    };
    const t = setTimeout(() => setCount(dueNow()), WORD_MS);
    return () => clearTimeout(t);
  }, [count, done, loop, tokens.length]);

  return (
    <div className={fill ? "bui-stream fill" : "bui-stream"}>
      <p className="bui-stream-text">
        {tokens.slice(0, count).map((token, i) =>
          token.cite && sources.length > 0 ? (
            <a
              key={i}
              className="bui-cite-chip"
              href={sources[0].href}
              target="_blank"
              rel="noreferrer"
            >
              {sources[0].domain}
            </a>
          ) : (
            <span key={i} className="bui-stream-token">
              {token.text}
            </span>
          ),
        )}
        {!done && <span className="bui-stream-cursor" aria-hidden />}
      </p>

      {sources.length > 0 && done && (
        <div className="bui-stream-sources">
          <button
            type="button"
            aria-expanded={sourcesOpen}
            onClick={() => setSourcesOpen((current) => !current)}
            className="bui-sources-toggle"
          >
            <span className="bui-sources-label">{sources.length} sources</span>
          </button>
          {sourcesOpen && (
            <div className="bui-sources-list">
              {sources.map((source) => (
                <a
                  key={source.domain}
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                  className="bui-source-row"
                >
                  <span>{source.name}</span>
                  <span className="bui-source-domain">{source.domain}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {followUps.length > 0 && done && (
        <div className="bui-stream-followups">
          <div className="bui-followups-label">Follow-ups</div>
          {followUps.map((text, i) => (
            <button
              key={text}
              type="button"
              className="bui-followup"
              onClick={() => onFollowUp?.(text, i)}
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
