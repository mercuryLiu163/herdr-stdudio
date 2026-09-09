/**
 * F4 chat view: parse a pane's `recent_unwrapped` transcript into structured
 * conversation blocks.
 *
 * Pure functions, no React/DOM dependency. Rules are marker heuristics
 * (deliberately not bound to one agent's TUI):
 *
 *   1. strip ANSI escape sequences;
 *   2. drop TUI decoration: separator-only lines (───…), "Worked for …"
 *      status lines (kept as weak `meta` blocks), bare trailing prompts
 *      (`❯` / `›` / shell prompt with nothing typed), repeated blanks;
 *   3. classify blocks:
 *        - `❯ ` / `> ` prefixed line            → user message
 *        - shell-prompt + typed command         → user message
 *          (starship `… HH:MM > cmd`, `PS …>`, `C:\…>`, `user@host:~$`)
 *        - `⏺` / `●` / `• ` prefixed line       → tool call card
 *        - ``` fenced run                       → code block
 *        - everything else                      → assistant prose (newlines kept)
 */

export type BlockType = "user" | "assistant" | "tool" | "code" | "meta";

export interface Block {
  type: BlockType;
  text: string;
}

/** Remove ANSI escape sequences (CSI, OSC, charset selection, stray C0). */
export function stripAnsi(input: string): string {
  return (
    input
      // OSC: ESC ] ... BEL  or  ESC ] ... ESC \
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      // CSI: ESC [ params final-byte
      .replace(/\x1b\[[0-9:;<=>?]*[ -/]*[@-~]/g, "")
      // charset / mode escapes like ESC ( B
      .replace(/\x1b[()][0-9A-B0-2]/g, "")
      // other C0 controls except \n and \t
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
  );
}

/** A line made solely of box-drawing/rule decoration. */
function isSeparatorLine(line: string): boolean {
  return /^[─━│━\-=~_•·\s]*[─━][─━\-=~_\s]*$/.test(line) && /[─━]/.test(line);
}

/**
 * If the line is a user-prompt marker or a shell prompt followed by a typed
 * command, return the typed text (possibly "" for a bare prompt). Return null
 * when the line does not look like user input at all.
 */
function extractUserInput(line: string): string | null {
  // Explicit user marker (PRD): "❯ " / "> " prefix.
  let m = line.match(/^[❯›>]\s?(.*)$/);
  if (m) return m[1].trim();

  // starship-style prompt: `<path> <branch> <tool> HH:MM > command`
  // (verified against herdr's bundled shell prompt)
  m = line.match(/^.*?\b\d{1,2}:\d{2}\b[^>]*>\s?(.*)$/);
  if (m) return m[1].trim();

  // PowerShell: `PS C:\…> command`
  m = line.match(/^PS\s+[^>]*>\s?(.*)$/);
  if (m) return m[1].trim();

  // cmd.exe: `C:\path> command`
  m = line.match(/^[A-Za-z]:\\[^>]*>\s?(.*)$/);
  if (m) return m[1].trim();

  // bash/zsh ssh-style: `user@host:~/path$ command`
  m = line.match(/^[\w.@~-]+@[\w.-]+:[^\n]*?[$#]\s?(.*)$/);
  if (m) return m[1].trim();

  return null;
}

/** Parse a full transcript into ordered blocks. */
export function parseTranscript(text: string): Block[] {
  const clean = stripAnsi(text).replace(/\r/g, "");
  const lines = clean.split("\n");

  const blocks: Block[] = [];
  let assistantBuf: string[] = [];
  let codeBuf: string[] | null = null;

  const flushAssistant = () => {
    if (!assistantBuf.length) return;
    const joined = assistantBuf.join("\n").trim();
    assistantBuf = [];
    if (joined) blocks.push({ type: "assistant", text: joined });
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    // Inside a fenced code block: collect verbatim until the closing fence.
    if (codeBuf !== null) {
      if (/^```/.test(trimmed)) {
        const body = codeBuf.join("\n").replace(/\s+$/, "");
        if (body) blocks.push({ type: "code", text: body });
        codeBuf = null;
      } else {
        codeBuf.push(line);
      }
      continue;
    }

    // Collapse blank runs.
    if (!trimmed) continue;
    // Drop rule/box decoration lines.
    if (isSeparatorLine(trimmed)) continue;

    // Fenced code opens.
    if (/^```/.test(trimmed)) {
      flushAssistant();
      codeBuf = [];
      continue;
    }

    // "Worked for 12s" style status line → weak meta separator.
    if (/^worked for\b/i.test(trimmed)) {
      flushAssistant();
      blocks.push({ type: "meta", text: trimmed });
      continue;
    }

    // User input (typed command or explicit ❯/> marker). Bare prompts ("" rest)
    // are decoration — dropped.
    const userRest = extractUserInput(trimmed);
    if (userRest !== null) {
      flushAssistant();
      if (userRest) blocks.push({ type: "user", text: userRest });
      continue;
    }

    // Tool-call markers: ⏺ / ● / •
    const tool = trimmed.match(/^[⏺●]\s?(.*)$/) ?? trimmed.match(/^•\s+(.*)$/);
    if (tool) {
      flushAssistant();
      const body = (tool[1] ?? "").trim();
      if (body) blocks.push({ type: "tool", text: body });
      continue;
    }

    assistantBuf.push(trimmed);
  }

  // Unterminated fence: flush what we collected as code.
  if (codeBuf !== null) {
    const body = codeBuf.join("\n").replace(/\s+$/, "");
    if (body) blocks.push({ type: "code", text: body });
  }
  flushAssistant();

  return blocks;
}
