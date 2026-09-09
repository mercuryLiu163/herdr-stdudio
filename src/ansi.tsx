import { useMemo } from "react";
import Anser from "anser";

/**
 * V3 F3 perf (b): ANSI→HTML parse cache keyed by pane id. The unified mosaic
 * re-renders a cell whenever its store slice changes, but the expensive part
 * (anser) only runs when the pane's text actually changed — identical text
 * returns the cached html string (which also lets React skip the innerHTML
 * write, since the string is referentially the same).
 */
const ansiCache = new Map<string, { text: string; html: string }>();
const ANSI_CACHE_MAX = 64;

function parse(text: string): string {
  // Trim trailing whitespace-only noise from the read window.
  const payload = text.replace(/\s+$/, "");
  return payload ? Anser.ansiToHtml(payload, { use_classes: true }) : "";
}

export function ansiToHtml(paneId: string | null | undefined, text: string): string {
  if (!text) return "";
  if (!paneId) return parse(text);
  const hit = ansiCache.get(paneId);
  if (hit && hit.text === text) return hit.html;
  const html = parse(text);
  if (!hit && ansiCache.size >= ANSI_CACHE_MAX) {
    // Simple FIFO eviction: Map iteration order is insertion order.
    const oldest = ansiCache.keys().next().value;
    if (oldest !== undefined) ansiCache.delete(oldest);
  }
  ansiCache.set(paneId, { text, html });
  return html;
}

/**
 * Render raw ANSI text (pane.read format=ansi) as styled HTML.
 * Uses anser's class mode so colors come from our own palette. Pass `paneId`
 * to route through the per-pane cache.
 */
export function AnsiView({ text, paneId }: { text: string; paneId?: string | null }) {
  const html = useMemo(() => ansiToHtml(paneId, text), [text, paneId]);
  return (
    <div
      className="ansi"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
