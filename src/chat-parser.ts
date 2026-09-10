/**
 * Chat view parser: parse a pane's `recent_unwrapped` transcript into
 * structured conversation blocks.
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
 *          (starship `… HH:MM > cmd`, `PS …>`, `C:\…>`, `user@host:~$`);
 *          an `echo …; echo …` chain is shell noise (harness/TUI echo of
 *          typed commands), not chat input → dropped
 *        - `⏺` / `●` / `• ` prefixed line       → tool call (name + summary)
 *        - ``` fenced run                       → code block (+ fence language)
 *        - everything else                      → assistant prose = markdown
 *                                                 source (newlines kept)
 *
 * V3 F2 additions: assistant `text` is the markdown source; tool blocks carry
 * `toolName` (colored chip) and the full body as `text`; image file paths found
 * in assistant/tool text are pulled out into `images` (and removed from the
 * text, so the bare path never renders as prose); code blocks carry `lang`.
 *
 * V4 F1 additions (transcript → app typography, never raw TUI passthrough):
 *        - `Thought for Ns…` / `Thinking…` (optional `(ctrl+o to expand)`)
 *          → dedicated `thinking` block (`text` = duration label like "4s"),
 *          no longer assistant prose;
 *        - `✻ Baked for Ns` / `Worked for Ns` / `… in Ns` status lines →
 *          `meta` (leading ✻/※ ornament stripped);
 *        - TUI footer/status-bar lines (`▸▸ …`, `? for shortcuts`,
 *          `shift+tab to cycle`, and ✻/※-prefixed lines that are NOT meta
 *          format) are dropped entirely;
 *        - a multi-column file listing inside a tool block (consecutive lines
 *          with ≥2 whitespace-separated file-name-ish tokens each) is folded
 *          into the tool block's `files` so the UI can re-layout it as a CSS
 *          grid — the ragged TUI columns never render as-is.
 */

export type BlockType = "user" | "assistant" | "tool" | "code" | "meta" | "thinking";

export interface Block {
  type: BlockType;
  /** user: typed text · assistant: markdown source · tool: full body · code: verbatim · thinking: duration label */
  text: string;
  /** tool blocks: the tool identifier shown in the chip */
  toolName?: string;
  /** code blocks: fence language (lower-cased), "" when absent */
  lang?: string;
  /** assistant / tool blocks: image paths extracted out of `text` */
  images?: string[];
  /** tool blocks: file/directory names of a multi-column listing, grid-rendered */
  files?: string[];
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
 * True when the captured prompt text is a pure `echo` chain (e.g. the echo of
 * typed shell commands — the standard test-harness/TUI seeding pattern), i.e.
 * shell noise rather than a chat prompt. Requires ≥2 echo segments: a single
 * `echo …` can be a legitimate prompt. Such prompt lines are dropped: the
 * echoed arguments would otherwise leak patterns like "Baked for 28s" into a
 * user block.
 */
function isEchoChain(rest: string): boolean {
  if (!/echo/.test(rest)) return false;
  const segs = rest.split(";");
  if (segs.length < 2) return false;
  return segs.every((seg) => /^\s*echo\b/.test(seg));
}

/**
 * If the line is a user-prompt marker or a shell prompt followed by a typed
 * command, return the typed text (possibly "" for a bare prompt or a pure
 * `echo` chain — both are decoration). Return null when the line does not look
 * like user input at all.
 */
function extractUserInput(line: string): string | null {
  const classify = (rest: string) => {
    const t = rest.trim();
    if (t && isEchoChain(t)) return ""; // echo chain = shell noise, drop line
    return t;
  };

  // Explicit user marker (PRD): "❯ " / "> " prefix.
  let m = line.match(/^[❯›>]\s?(.*)$/);
  if (m) return classify(m[1]);

  // starship-style prompt: `<path> <branch> <tool> HH:MM > command`
  // (verified against herdr's bundled shell prompt)
  m = line.match(/^.*?\b\d{1,2}:\d{2}\b[^>]*>\s?(.*)$/);
  if (m) return classify(m[1]);

  // PowerShell: `PS C:\…> command`
  m = line.match(/^PS\s+[^>]*>\s?(.*)$/);
  if (m) return classify(m[1]);

  // cmd.exe: `C:\path> command`
  m = line.match(/^[A-Za-z]:\\[^>]*>\s?(.*)$/);
  if (m) return classify(m[1]);

  // bash/zsh ssh-style: `user@host:~/path$ command`
  m = line.match(/^[\w.@~-]+@[\w.-]+:[^\n]*?[$#]\s?(.*)$/);
  if (m) return classify(m[1]);

  return null;
}

/**
 * Thinking-collapse line (V4 F1): `Thought for 4s…`, `Thinking…`, either with
 * an optional `(ctrl+o to expand)` suffix. Returns the duration label
 * ("4s"), or "" when the line carries no duration; null when not a thinking
 * line.
 */
export function thinkingOf(line: string): string | null {
  let m =
    line.match(/^thought\s+for\s+([\d.]+)\s*s\b[^()]*\(ctrl\+o to expand\)\s*$/i) ??
    line.match(/^thought\s+for\s+([\d.]+)\s*s\b[^()]*$/i);
  if (m) return `${m[1]}s`;
  m = line.match(/^thinking\b[^()]*\(ctrl\+o to expand\)\s*$/i) ?? line.match(/^thinking(?:…|\.\.\.)?\s*$/i);
  if (m) return "";
  return null;
}

/**
 * Agent status line → meta separator text (V4 F1): `Worked for 12s`,
 * `✻ Baked for 28s`, `… done in 3s`. The leading ✻/※/… ornament is stripped
 * from the returned label. Null when the line is not a meta status line.
 */
export function metaOf(line: string): string | null {
  const m =
    line.match(/^[✻※]?\s*(?:worked|baked)\s+for\s+[\d.]+\s*s\b[^;]*$/i) ??
    line.match(/^[✻※…]\s*\S.*\bin\s+[\d.]+\s*s\.?$/i);
  if (!m) return null;
  return line.replace(/^[✻※]\s*/, "");
}

/**
 * TUI footer / status-bar decoration (V4 F1): these lines are dropped whole.
 * ✻/※-prefixed lines are handled separately (meta format → meta, else drop).
 */
const FOOTER_RES: RegExp[] = [
  /^▸/, // herdr/claude status bar arrows: "▸▸ bypass permissions on …"
  /^\(?\? for shortcuts\)?/i, // key hint footer
  /shift\+tab to cycle/i, // permission-mode line
];

function isFooterLine(line: string): boolean {
  return FOOTER_RES.some((re) => re.test(line));
}

/**
 * File/directory-name-ish token: short, restricted charset (internal `/`
 * allowed for nested paths like `src/a.ts`), and carrying a file-name
 * feature — a `.<ext>` suffix or a trailing `/` (directory).
 */
const NAME_TOKEN_RE = /^[A-Za-z0-9_@#+][A-Za-z0-9_@#+./-]*$/;

function isNameToken(tok: string): boolean {
  if (!tok || tok.length > 64 || !NAME_TOKEN_RE.test(tok)) return false;
  return tok.endsWith("/") || /\.[A-Za-z0-9_#+-]+$/.test(tok);
}

/** Bare prompt/shell symbols that must never become file chips (`❯ $ # …`). */
const PROMPT_SYMBOL_RE = /^[❯›>$#●⏺•▸✻※|]+$/;

/**
 * A multi-column file-listing line (V4 F1): ≥2 whitespace-separated tokens of
 * which ≥2 look like file/directory names. Prompt/shell symbol tokens are
 * ignored (never counted, never stored). Returns the chip tokens or null.
 */
export function fileListTokens(line: string): string[] | null {
  const toks = line.split(/\s+/).filter((t) => t && !PROMPT_SYMBOL_RE.test(t));
  if (toks.length < 2) return null;
  let hits = 0;
  for (const t of toks) if (isNameToken(t)) hits++;
  // Majority of tokens must be name-ish, so prose lines with a stray path
  // never qualify.
  if (hits < 2 || hits < Math.ceil(toks.length / 2)) return null;
  return toks;
}

/** Image extensions we inline (must also be readable through fs:read). */
export const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg)$/i;

/**
 * A file-path-looking token ending in an image extension: optional drive
 * letter, then path characters, then the extension at a word boundary.
 * Quotes/brackets/backticks around the path are not part of the match.
 * A leading boundary (line start, whitespace, or an opening bracket/quote/
 * assignment character) is REQUIRED, so the tail of a URL in prose
 * (`https://cdn.example/img/logo.png`) is no longer ripped out — the segment
 * after the last `/` has no boundary before it (review #4).
 */
const IMAGE_PATH_RE =
  /(?<=^|[\s([{"'`=~*>（「《【])(?:[A-Za-z]:[\\/])?(?:[\w.~-]+[\\/])*[\w.~-]+\.(?:png|jpe?g|gif|webp|svg)(?![\w.])/gim;

/** Pull image paths out of prose; returns the remaining text and the paths. */
export function extractImagePaths(text: string): { text: string; images: string[] } {
  const images: string[] = [];
  const stripped = text.replace(IMAGE_PATH_RE, (m) => {
    if (!images.includes(m)) images.push(m);
    return "";
  });
  if (!images.length) return { text, images };
  const cleaned = stripped
    .split("\n")
    .map((l) => l.replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n")
    .trim();
  return { text: cleaned, images };
}

/**
 * Tool identifier for the chip: `Name(args)` style → Name; otherwise the
 * first ASCII identifier in the body (e.g. "运行 npm test" → "npm"); otherwise
 * the first whitespace-delimited token.
 */
export function toolNameOf(body: string): string {
  const call = body.match(/^([A-Za-z_][\w.-]*)\s*\(/);
  if (call) return call[1];
  const ascii = body.match(/[A-Za-z_][\w.+-]*/);
  if (ascii) return ascii[0];
  return body.split(/\s+/)[0] ?? "tool";
}

/** Parse a full transcript into ordered blocks. */
export function parseTranscript(text: string): Block[] {
  const clean = stripAnsi(text).replace(/\r/g, "");
  const lines = clean.split("\n");

  const blocks: Block[] = [];
  let assistantBuf: string[] = [];
  let codeBuf: { lang: string; lines: string[] } | null = null;
  /** Tool block currently accepting file-listing lines (V4 F1), if any. */
  let fileCtx: Block | null = null;

  const flushAssistant = () => {
    if (!assistantBuf.length) return;
    const joined = assistantBuf.join("\n").trim();
    assistantBuf = [];
    if (!joined) return;
    const { text: md, images } = extractImagePaths(joined);
    if (!md && !images.length) return;
    const block: Block = { type: "assistant", text: md };
    if (images.length) block.images = images;
    blocks.push(block);
  };

  const flushCode = () => {
    if (codeBuf === null) return;
    const body = codeBuf.lines.join("\n").replace(/\s+$/, "");
    if (body) blocks.push({ type: "code", text: body, lang: codeBuf.lang });
    codeBuf = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    // Inside a fenced code block: collect verbatim until the closing fence.
    if (codeBuf !== null) {
      if (/^```/.test(trimmed)) flushCode();
      else codeBuf.lines.push(line);
      continue;
    }

    // Collapse blank runs.
    if (!trimmed) continue;
    // Drop rule/box decoration lines.
    if (isSeparatorLine(trimmed)) continue;

    // Fenced code opens (optionally with a language tag).
    const fence = trimmed.match(/^```\s*([\w+#.-]*)/);
    if (fence) {
      flushAssistant();
      fileCtx = null;
      codeBuf = { lang: (fence[1] ?? "").toLowerCase(), lines: [] };
      continue;
    }

    // Multi-column file listing inside a tool block (V4 F1): fold into the
    // open tool block so the UI can grid it. Any other line closes the
    // listing context.
    if (fileCtx !== null) {
      const toks = fileListTokens(trimmed);
      if (toks) {
        fileCtx.files = [...(fileCtx.files ?? []), ...toks];
        continue;
      }
      fileCtx = null;
    }

    // Thinking-collapse line → dedicated weak block, never assistant prose.
    const thinking = thinkingOf(trimmed);
    if (thinking !== null) {
      flushAssistant();
      fileCtx = null;
      blocks.push({ type: "thinking", text: thinking });
      continue;
    }

    // Status line → weak meta separator (✻ Baked for 28s / Worked for 12s).
    const meta = metaOf(trimmed);
    if (meta !== null) {
      flushAssistant();
      fileCtx = null;
      blocks.push({ type: "meta", text: meta });
      continue;
    }

    // User input (typed command or explicit ❯/> marker) — checked BEFORE the
    // footer rules (review m1): a real prompt like "❯ how do I use shift+tab
    // to cycle modes?" contains footer substrings and must be kept. Bare
    // prompts ("" rest) and pure `echo` chains are decoration — dropped.
    const userRest = extractUserInput(trimmed);
    if (userRest !== null) {
      flushAssistant();
      fileCtx = null;
      if (userRest) blocks.push({ type: "user", text: userRest });
      continue;
    }

    // TUI footer/status-bar decoration → drop the whole line. The seed-style
    // footer ("▸▸ bypass permissions on (shift+tab to cycle)") starts with
    // ▸▸, which no prompt rule matches, so it still lands here and is dropped.
    if (isFooterLine(trimmed) || /^[✻※]/.test(trimmed)) {
      continue;
    }

    // Tool-call markers: ⏺ / ● / •
    const tool = trimmed.match(/^[⏺●]\s?(.*)$/) ?? trimmed.match(/^•\s+(.*)$/);
    if (tool) {
      flushAssistant();
      const body = (tool[1] ?? "").trim();
      fileCtx = null;
      if (body) {
        const { text: summary, images } = extractImagePaths(body);
        const block: Block = { type: "tool", text: summary || body, toolName: toolNameOf(body) };
        if (images.length) block.images = images;
        blocks.push(block);
        fileCtx = block; // a listing may follow the call line
      }
      continue;
    }

    assistantBuf.push(trimmed);
  }

  // Unterminated fence: flush what we collected as code.
  flushCode();
  flushAssistant();

  return blocks;
}
