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
 *
 * V6 F2 additions (parse quality — prose is never a tool, TUI is never text):
 *        - a leading TUI tree/box-drawing prefix (`└ ┌ │ ├` glyphs plus `──`
 *          connector runs and the spaces between them) is stripped BEFORE
 *          classification, so `└ Set model to …` classifies as plain
 *          assistant prose and no tree glyph ever reaches a block;
 *        - a marker line (`⏺ ● • ◆`) is only a tool call when its remaining
 *          text validates as one: the `Name(…)` call form always does;
 *          otherwise the first word group must be ≤3 words and must not start
 *          with a sentence-starter word ("Looks/It/The…" → the whole line is
 *          assistant prose, marker glyph stripped). The tool summary comes
 *          only from the marker line itself; following marker-less natural
 *          lines flow back into the assistant stream (except V4 file
 *          listings / code fences, which keep their dedicated handling).
 */

export type BlockType = "user" | "assistant" | "tool" | "code" | "meta" | "thinking";

export interface Block {
  type: BlockType;
  /** user: typed text · assistant: markdown source · tool: full body (detail view) · code: verbatim · thinking: duration label */
  text: string;
  /** tool blocks: the tool identifier shown in the chip */
  toolName?: string;
  /** tool blocks: one-line row summary (call-form argument; = text when the
   *  body is not a `Name(args)` call). The row shows this, the expanded
   *  detail shows the full `text` (review m1). */
  summary?: string;
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
 * Leading TUI tree/box-drawing prefix (V6 F2): `└ ┌ │ ├ │`-family glyphs plus
 * `──` connector runs and the whitespace between them — and (review M2) the
 * Claude Code result glyphs `⎿ ⏋ ⏌`, so a tool's result line
 * (`⎿  Updated … with 3 additions`) strips to plain assistant text instead of
 * leaking the glyph into the stream. Stripped from the line BEFORE
 * classification so the remainder classifies by its own content.
 * Deliberately excludes prose punctuation (em/en dash, `▸`, `✻`, `›`) so real
 * content is never eaten.
 */
const TREE_PREFIX_RE = /^[└┌┐┘│┝┠┣├┤┬┴┼╭╮╯╰╔╗╚╝╠╣╦╩╬═║─┄┅┆┇┈┉┊⎾⎿⏋⏌\s]+/;

/**
 * A tool-call marker line (V6 F2): one of the `⏺ ● • ◆` glyphs followed by the
 * line's remaining text. The marker alone is not enough — see
 * {@link validToolCall}.
 */
const TOOL_MARKER_RE = /^[⏺●•◆]\s?(.*)$/;

/**
 * Sentence-starter words that can never begin a tool name (V6 F2): agent prose
 * written next to a bullet glyph ("● Looks like a test …") must fall back to
 * the assistant stream, not masquerade as a tool named "Looks".
 */
const SENTENCE_STARTER_WORDS = new Set([
  "a", "all", "also", "am", "an", "and", "any", "are", "as", "at", "be", "been",
  "being", "both", "but", "by", "can", "could", "did", "do", "does", "done",
  "each", "either", "every", "feel", "felt", "for", "from", "get", "got", "had",
  "has", "have", "he", "her", "here", "hers", "him", "his", "how", "i", "if",
  "in", "is", "it", "its", "just", "let", "looks", "may", "me", "might", "must",
  "my", "no", "not", "now", "of", "oh", "on", "one", "only", "or", "other",
  "our", "ours", "please", "seems", "shall", "she", "should", "so", "some",
  "sorry", "sure", "than", "that", "the", "their", "them", "then", "there",
  "these", "they", "this", "those", "to", "up", "us", "was", "we", "were",
  "what", "when", "where", "which", "who", "whom", "whose", "why", "will",
  "with", "would", "yes", "yet", "you", "your", "yours",
]);

/**
 * Validate the text after a tool marker as an actual tool call (V6 F2).
 * Returns the validated tool name, or null when the line is prose:
 *  - the `Name(…)` call form (identifier + open paren) always validates —
 *    that is how every real TUI renders a structured invocation;
 *  - otherwise the first word group must be ≤3 words AND its leading word
 *    must not be a sentence-starter, so "● Looks like a test …" (9 words,
 *    sentence-starter) and "● This is fine" fall back to assistant prose.
 * The derived name loses trailing punctuation (review m3): `● Done.` chips
 * as "Done", not "Done.".
 */
function validToolCall(rest: string): string | null {
  const call = rest.match(/^([A-Za-z_][\w.+-]*)\s*\(/);
  if (call) return call[1];
  const words = rest.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return null;
  if (SENTENCE_STARTER_WORDS.has(words[0].toLowerCase())) return null;
  const name = toolNameOf(rest).replace(/[.,;:!?)\]}…。！？；：、"'”’]+$/, "");
  return name || null;
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

    // Inside a fenced code block: collect verbatim until the closing fence.
    if (codeBuf !== null) {
      if (/^```/.test(line.trim())) flushCode();
      else codeBuf.lines.push(line);
      continue;
    }

    // V6 F2: strip a leading TUI tree/box-drawing prefix (`└ Set model to …`,
    // `│ …`, `├── …`) BEFORE classification — tree glyphs never reach a block
    // and the remainder classifies by its own content.
    const trimmed = line.replace(TREE_PREFIX_RE, "").trim();

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

    // Tool-call marker line (V6 F2): the marker alone is NOT a tool — the
    // remaining text must validate as one (call form / short non-sentence
    // word group). Rejected marker lines are prose: their text (marker glyph
    // stripped) flows back into the assistant stream.
    const tool = trimmed.match(TOOL_MARKER_RE);
    if (tool) {
      const body = (tool[1] ?? "").trim();
      if (!body) continue; // bare marker with no payload: decoration — drop
      const toolName = validToolCall(body);
      if (toolName === null) {
        // Prose next to a bullet glyph → assistant text, marker stripped.
        fileCtx = null;
        assistantBuf.push(body);
        continue;
      }
      flushAssistant();
      // V6 F2 / review m1: the ROW shows the call-form argument ("npm run
      // build"), the expanded detail shows the full `Name(args)` body —
      // never "Bash(Bash…)" twice. Non-call forms: both carry the body.
      const call = body.match(/^[A-Za-z_][\w.+-]*\s*\((.*)\)\s*$/);
      const rowSrc = call ? (call[1].trim() || body) : body;
      const { text: summary, images } = extractImagePaths(rowSrc);
      // Image paths pulled out of the row must not reappear in the detail.
      const { text: detail } = images.length ? extractImagePaths(body) : { text: body };
      const block: Block = { type: "tool", text: detail, toolName, summary: summary || body };
      if (images.length) block.images = images;
      blocks.push(block);
      fileCtx = block; // a listing may follow the call line
      continue;
    }

    assistantBuf.push(trimmed);
  }

  // Unterminated fence: flush what we collected as code.
  flushCode();
  flushAssistant();

  return blocks;
}

/**
 * V5 F1 turn grouping: a turn is the sequence of blocks from a user prompt up
 * to (not including) the next user prompt; blocks before the first user block
 * form the leading turn (the transcript may open mid-conversation). Only user
 * blocks open turns — meta separators (`Worked for Ns`) and thinking rows
 * belong to the turn they stream in, so a turn's header can summarize its
 * tool steps, touched files and duration.
 */
export interface Turn {
  /** user prompt blocks that opened this turn ([] for the leading turn) */
  users: Block[];
  /** agent-produced blocks rendered under the turn header */
  body: Block[];
}

export function groupTurns(blocks: Block[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn = { users: [], body: [] };
  for (const b of blocks) {
    if (b.type === "user") {
      // Flush whatever came before this prompt — including the LEADING turn
      // (blocks accumulated before the first user block, e.g. when the pane's
      // rolling window starts mid-conversation). Never drop it.
      if (cur.users.length || cur.body.length) turns.push(cur);
      cur = { users: [b], body: [] };
    } else {
      cur.body.push(b);
    }
  }
  if (cur.users.length || cur.body.length) turns.push(cur);
  return turns;
}

/**
 * Turn header stats for a turn body (V5 F1): tool-step count, deduplicated
 * file paths from tool blocks (order preserved), and the duration label of
 * the first meta line carrying one ("Worked for 12s" → "12s"). Everything is
 * derived from the transcript only — missing data simply stays undefined, the
 * header never invents numbers (no token/±line counts: herdr has none).
 */
export interface TurnStats {
  steps: number;
  files: string[];
  duration: string | null;
}

export function turnStats(turn: Turn): TurnStats {
  const files: string[] = [];
  let steps = 0;
  let duration: string | null = null;
  for (const b of turn.body) {
    if (b.type === "tool") {
      steps++;
      for (const f of b.files ?? []) if (!files.includes(f)) files.push(f);
    } else if (b.type === "meta" && duration === null) {
      const m = b.text.match(/([\d.]+)\s*s\b/i);
      if (m) duration = `${m[1]}s`;
    }
  }
  return { steps, files, duration };
}
