import { useMemo } from "react";
import Anser from "anser";

/**
 * Render raw ANSI text (pane.read format=ansi) as styled HTML.
 * Uses anser's class mode so colors come from our own palette.
 */
export function AnsiView({ text }: { text: string }) {
  const html = useMemo(() => {
    if (!text) return "";
    // Trim trailing whitespace-only noise from the read window.
    const payload = text.replace(/\s+$/, "");
    return Anser.ansiToHtml(payload, { use_classes: true });
  }, [text]);
  return (
    <div
      className="ansi"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
