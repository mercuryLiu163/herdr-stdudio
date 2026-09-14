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
 *
 * V7 F1 additions (user prompt as a markdown card, not a TUI line):
 *        - after a `❯` / shell user line, structural continuation lines
 *          (markdown lists, `URL:` labels, bare http(s) URLs, indented wraps)
 *          are appended to that same user block so the UI can re-layout them
 *          as a collapsible card. A tool / meta / thinking / new user / fence
 *          always closes the continuation.
 *
 * V7 F4 additions (ZCODE / product TUI chrome is never conversation):
 *        - `◆ ZCODE v…` banner, welcome box (`Ask a task…`, `/help commands`,
 *          `path · branch` chip), update nags, and the model/ctx/cache
 *          status footer are dropped;
 *        - `[ ✓ 5s ]` is a duration meta line (turn pill), not prose;
 *        - `looksLikeChat` is true when a shell transcript is actually a
 *          conversation (so 分屏 defaults to the chat view, not the TUI dump).
 *
 * V8 additions (Grok Build TUI):
 *        - splash / braille-art welcome (`Grok Build 1.0.30`, `/feedback`,
 *          `New worktree ctrl+w`, empty `❯` prompt box) is dropped, never
 *          assistant prose;
 *        - `Grok 4.6 (medium) · always-approve` is session chrome (composer
 *          status), not a chat block — see {@link extractComposerStatus};
 *        - trailing TUI clocks (`1:14 AM`) and box-drawing leftovers on
 *          user rows are stripped.
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
    const t = sanitizeUserText(rest);
    if (t && isEchoChain(t)) return ""; // echo chain = shell noise, drop line
    if (/^\^C$/i.test(t)) return "";
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
const COOK_ORNAMENT = /^[◆❖♦◇⬥*✽※✻✦]\s*/;
const COOKING_RE =
  /^(?:[◆❖♦◇⬥*✽※✻✦]\s*)?(Kneading|Whisking|Frosting|Baking|Simmering|Saut[eé]ing|Mixing|Blending|Brewing|Crunching|Distilling|Noodling|Percolating|Accomplishing)\b/i;

export function cookingOf(line: string): { duration: string | null; done: boolean } | null {
  const stripped = line.replace(COOK_ORNAMENT, "").trim();
  if (!COOKING_RE.test(line.trim()) && !COOKING_RE.test(stripped)) return null;
  const dur = line.match(/([\d.]+)\s*s/);
  const done = /thinking\s*\)/i.test(line) || /stop hook/i.test(line) || !!dur;
  return { duration: dur ? `${dur[1]}s` : null, done };
}

export function thinkingOf(line: string): string | null {
  const cook = cookingOf(line);
  if (cook) return cook.duration ?? "";
  const stripped = line.replace(COOK_ORNAMENT, "").trim();
  let m =
    stripped.match(/^thought\s+for\s+([\d.]+)\s*s/i) ??
    stripped.match(/^thinking\s+for\s+([\d.]+)\s*s/i);
  if (m) return `${m[1]}s`;
  m =
    stripped.match(/^thinking\b.*ctrl\s*\+\s*o to expand/i) ??
    stripped.match(/^thinking(?:…|\.\.\.)?\s*$/i) ??
    stripped.match(/^thought\b.*ctrl\s*\+\s*o to expand/i) ??
    stripped.match(/^thought\b/i);
  if (m) return "";
  return null;
}

/**
 * Agent status line → meta separator text (V4 F1): `Worked for 12s`,
 * `✻ Baked for 28s`, `… done in 3s`. The leading ✻/※/… ornament is stripped
 * from the returned label. Null when the line is not a meta status line.
 */
export function metaOf(line: string): string | null {
  const zcodeDur = line.match(/^\[\s*[✓✔√]\s*([\d.]+)\s*s\s*\]$/);
  if (zcodeDur) return `${zcodeDur[1]}s`;
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
  /^⏵/, // filled triangle variant seen in live Claude TUI
  /^\(?\? for shortcuts\)?/i,
  /shift\+tab to cycle/i,
  /shift\s*\+\s*tab:mode/i,
  /ctrl\s*\+\s*x:shortcuts/i,
  /bypass permissions/i,
];

function isFooterLine(line: string): boolean {
  return FOOTER_RES.some((re) => re.test(line));
}

/**
 * Product / TUI chrome that must never become a user/tool/assistant block
 * (ZCODE welcome box, update nag, model status footer).
 */
export function isChromeLine(line: string): boolean {
  if (/^[◆❖♦◇⬥]?\s*ZCODE\b/i.test(line)) return true;
  if (/\bctx\s+\d+%/i.test(line) && /\bcache\s+\d+%/i.test(line)) return true;
  if (/^Ask a task about this workspace/i.test(line)) return true;
  if (/^\/help commands/i.test(line)) return true;
  if (/update available/i.test(line)) return true;
  if (/^Run npm install -g /i.test(line)) return true;
  if (/^Release notes:?$/i.test(line)) return true;
  if (/zcode-cli\/releases/i.test(line)) return true;
  if (/^[A-Za-z]:[\\/][^\n]*·/.test(line)) return true;
  if (/^(?:to\s+)?expand\)?$/i.test(line)) return true;
  if (/^[\s)]+$/.test(line)) return true;
  // Claude Code splash / env nag
  if (/CLAUDE_CODE_[A-Z0-9_]+/.test(line)) return true;
  if (/UNKNOWN_MODEL_WINDOW_ENFORCEMENT/.test(line)) return true;
  if (/API Usage Billing/i.test(line)) return true;
  if (/Claude Code v?\d/i.test(line)) return true;
  if (/wait-for-the-API behavior/i.test(line)) return true;
  if (/to make it take effect/i.test(line)) return true;
  if (/^Your Windows\b/i.test(line)) return true;
  if (/running stop hook/i.test(line)) return true;
  if (/^[\u2580-\u259F█▓▒░■◼▪]/.test(line) && (line.match(/[\u2580-\u259F█▓▒░]/g) ?? []).length >= 3) return true;
  if (/^[A-Za-z]:[\\/][^\s│]+$/.test(line)) return true;
  if (/^Token usage:/i.test(line)) return true;
  if (/To continue this session, run /i.test(line)) return true;
  if (/^Tip: You can launch Claude Code/i.test(line)) return true;
  // Grok Build splash / empty prompt chrome (never conversation).
  if (/\bGrok Build\b/i.test(line)) return true;
  if (/Thanks for trying Grok Build/i.test(line)) return true;
  if (/give feedback with\s*\/feedback/i.test(line)) return true;
  if (/New worktree/i.test(line) && /ctrl\s*\+\s*w/i.test(line)) return true;
  if (/Resume session/i.test(line) && /ctrl\s*\+\s*[rn]/i.test(line)) return true;
  if (/^Quit\s+ctrl\s*\+\s*q/i.test(line)) return true;
  if (/\bGrok\s+[\d.]+\b/i.test(line) && /always-approve|plan mode|\(medium\)|\(low\)|\(high\)/i.test(line))
    return true;
  if (/\b\d+(?:\.\d+)?K\s*\/\s*\d+(?:\.\d+)?K\b/.test(line) && /\[Dashboard\]/i.test(line)) return true;
  if (/^\[Dashboard\]/i.test(line)) return true;
  if (/user_prompt_submit hook/i.test(line)) return true;
  if (isGarbledArt(line)) return true;
  if (/^[█░▒▓\s]+$/.test(line)) return true;
  if (/^[▼▲◀▶]+$/.test(line)) return true;
  return false;
}

/**
 * Grok's welcome screen is braille / box-drawing art. After ANSI strip it
 * becomes a soup of ⣿ / ░ / scattered punctuation — never assistant prose.
 */
function isGarbledArt(line: string): boolean {
  const braille = (line.match(/[\u2800-\u28FF]/g) ?? []).length;
  if (braille >= 4) return true;
  const boxes = (line.match(/[\u2500-\u257F█▓▒░■]/g) ?? []).length;
  const letters = (line.match(/[A-Za-z\u4e00-\u9fff]/g) ?? []).length;
  if (boxes >= 8 && letters < 8) return true;
  return false;
}

/** Trailing TUI clocks / box-drawing leftovers on a user prompt row. */
function sanitizeUserText(rest: string): string {
  let t = rest.trim();
  t = t.replace(/[\s\u2500-\u257F\u2580-\u259F]+$/g, "").trim();
  t = t.replace(/\s+\d{1,2}:\d{2}\s*[APap][Mm]\s*$/g, "").trim();
  t = t.replace(/[\s\u2500-\u257F]+$/g, "").trim();
  if (!t || /^[\u2500-\u257F|]+$/.test(t)) return "";
  return t;
}

export interface ComposerStatus {
  model?: string;
  /** reasoning effort: low | medium | high | xhigh */
  effort?: string;
  mode?: string;
  /** context window used, e.g. "2.3%" */
  ctx?: string;
}

function unitToNum(n: string, unit: string): number {
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return 0;
  const u = unit.toUpperCase();
  if (u === "B") return v * 1e9;
  if (u === "M") return v * 1e6;
  if (u === "K") return v * 1e3;
  return v;
}

/**
 * Last model / permission chips from a Grok (or similar) TUI footer, e.g.
 * `Grok 4.6 (medium) · always-approve`. Used by the composer, not the thread.
 */
export function extractComposerStatus(text: string): ComposerStatus {
  if (!text) return {};
  const clean = stripAnsi(text).replace(/\r/g, "");
  const tail = clean.split("\n").slice(-48);
  const found: ComposerStatus = {};
  for (const raw of tail) {
    const line = raw.replace(/[\u2500-\u257F\u2580-\u259F]+/g, " ").replace(/\s+/g, " ").trim();
    const grok = line.match(
      /\b(Grok\s+[\d.]+)\s*(?:\((low|medium|high|xhigh)\))?\s*[·•]\s*([A-Za-z][A-Za-z0-9 +_-]*)/i,
    );
    if (grok) {
      found.model = grok[1].replace(/\s+/g, " ").trim();
      if (grok[2]) found.effort = grok[2].toLowerCase();
      found.mode = grok[3].trim();
    } else {
      const generic = line.match(
        /\b((?:Claude|Opus|Sonnet|Haiku|GPT|o\d|Codex|Gemini)[^\n·•]{0,40}?)\s*[·•]\s*(always-approve|bypass permissions|accept edits|plan mode|default|ask|yolo)\b/i,
      );
      if (generic) {
        found.model = generic[1].replace(/\s+/g, " ").trim();
        found.mode = generic[2].trim();
      }
    }
    const effortOnly = line.match(/\((low|medium|high|xhigh)\)/i);
    if (effortOnly && !found.effort) found.effort = effortOnly[1].toLowerCase();
    const ctxm = line.match(/\b([\d.]+)\s*([KMBkmb])\s*\/\s*([\d.]+)\s*([KMBkmb])\b/);
    if (ctxm) {
      const used = unitToNum(ctxm[1], ctxm[2]);
      const total = unitToNum(ctxm[3], ctxm[4]);
      if (total > 0) {
        const pct = (used / total) * 100;
        found.ctx = `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%`;
      }
    }
    const ctxpct = line.match(/\bctx\s+(\d+%)/i);
    if (ctxpct) found.ctx = ctxpct[1];
  }
  return found;
}

/** Hidden chain-of-thought leaked by the TUI — never assistant prose. */
export function isInternalMonologue(line: string): boolean {
  return (
    /^The user (just )?(said|asked|wants|typed)\b/i.test(line) ||
    /^I should respond\b/i.test(line) ||
    /^No tools needed\b/i.test(line) ||
    /simple greeting/i.test(line) ||
    /^they(?:'re| are) communicating\b/i.test(line)
  );
}

/**
 * True when a pane transcript is a conversation, not a raw shell dump.
 * Used by 分屏 to open the chat view on ZCODE/Claude panes that herdr has
 * not (yet) classified as agents.
 */
export function looksLikeChat(text: string): boolean {
  if (!text) return false;
  const clean = stripAnsi(text);
  if (/ZCODE\b/i.test(clean)) return true;
  if (/\bGrok Build\b/i.test(clean) || /\bGrok\s+[\d.]+\s*\(/i.test(clean)) return true;
  if (/ctrl\s*\+\s*o to expand/i.test(clean)) return true;
  if (/^\[\s*[✓✔√]\s*[\d.]+\s*s\s*\]/m.test(clean)) return true;
  if (/^[❯›▸]\s*\S/m.test(clean)) return true;
  if (/^⏺\s+\S/m.test(clean)) return true;
  for (const line of clean.split("\n")) {
    const t = line.trim();
    if (/^[>❯›▸]\s*\S/.test(t) && !/^[A-Za-z]:\\/.test(t) && !/\b\d{1,2}:\d{2}\b/.test(t)) return true;
  }
  return false;
}

/**
 * Structural continuation of a user prompt (V7 F1). These lines are part of
 * the typed prompt's markdown body in the TUI (wrapped lists / URL labels),
 * not the assistant reply. Keep this tight: a prose sentence with no marker
 * must fall through to the assistant stream.
 */
export function isUserContinuation(line: string): boolean {
  return /^(?:[-*+] |\d+[.)] |#{1,6} |\s{2,}\S|URL\s*:|https?:\/\/)/i.test(line);
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
const TREE_PREFIX_RE = /^[└┌┐┘│┃┝┠┣├┤┬┴┼╭╮╯╰╔╗╚╝╠╣╦╩╬═║─┄┅┆┇┈┉┊⎾⎿⏋⏌\s]+/;

/**
 * A tool-call marker line (V6 F2): one of the `⏺ ● • ◆` glyphs followed by the
 * line's remaining text. The marker alone is not enough — see
 * {@link validToolCall}.
 */
const TOOL_MARKER_RE = /^[⏺●]\s?(.*)$/;

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
  // CJK prose after a bullet is never a tool (`● 你好！…`).
  if (/^[\u4e00-\u9fff]/.test(rest)) return null;
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
function isNewBlockLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (isSeparatorLine(t) || isChromeLine(t)) return true;
  if (/^```/.test(t)) return true;
  if (/^[❯›>⏺●◆❖]/.test(t)) return true;
  if (/^(?:[-*+]|•)\s/.test(t) || /^\d+[.)]\s/.test(t)) return true;
  if (thinkingOf(t) !== null || metaOf(t) !== null) return true;
  if (extractUserInput(t) !== null) return true;
  return false;
}

function joinSoftWrap(prev: string, next: string): string | null {
  const p = prev.trimEnd();
  const n = next.trim();
  if (!p || !n || isNewBlockLine(n)) return null;
  if (/^[❯›>]/.test(p.trim()) || extractUserInput(p.trim()) !== null) return null;
  if (/[。！？.!?]$/.test(p)) return null;
  if (/\.[A-Za-z0-9]{1,8}$/.test(p)) return null;
  if (/[:：]$/.test(p) && /^(?:[-*+•]|\d+[.)])/.test(n)) return null;
  if (/^[，。！？、；：,.!?]/.test(n)) {
    return p.replace(/\s+$/, "") + n.replace(/^\s+/, "");
  }
  const lastTok = p.split(/\s+/).pop() ?? "";
  if (/[A-Za-z0-9_]$/.test(p) && /^[a-z0-9_.]/.test(n)) {
    if (lastTok.length <= 3) return p + " " + n;
    return p + n;
  }
  if (/[A-Za-z0-9]$/.test(p) && /^[\u4e00-\u9fff]/.test(n)) return p + n;
  if (/[\u4e00-\u9fff]$/.test(p) && /^[\u4e00-\u9fff]/.test(n)) return p + n;
  return null;
}

/** Rejoin TUI hard-wraps (`batch_proc` + `ess_cameras.py`) before classifying. */
export function unwrapSoftWraps(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (out.length === 0) {
      out.push(line);
      continue;
    }
    const joined = joinSoftWrap(out[out.length - 1], line);
    if (joined !== null) out[out.length - 1] = joined;
    else out.push(line);
  }
  return out.join("\n");
}

export function toolNameOf(body: string): string {
  const call = body.match(/^([A-Za-z_][\w.-]*)\s*\(/);
  if (call) return call[1];
  const ascii = body.match(/[A-Za-z_][\w.+-]*/);
  if (ascii) return ascii[0];
  return body.split(/\s+/)[0] ?? "tool";
}

/** Parse a full transcript into ordered blocks. */
/** Keep the tail of a huge TUI dump so parse/render stay cheap. */
export function clipTranscript(text: string, maxChars = 24_000): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(-maxChars);
  const cut = slice.search(/\n[❯›>]\s/);
  return cut >= 0 ? slice.slice(cut + 1) : slice;
}

export function parseTranscript(text: string): Block[] {
  const clean = unwrapSoftWraps(stripAnsi(clipTranscript(text)).replace(/\r/g, ""));
  const lines = clean.split("\n");

  const blocks: Block[] = [];
  let assistantBuf: string[] = [];
  let codeBuf: { lang: string; lines: string[] } | null = null;
  /** Tool block currently accepting file-listing lines (V4 F1), if any. */
  let fileCtx: Block | null = null;
  /** User block currently accepting markdown continuation lines (V7 F1). */
  let userCtx: Block | null = null;
  /** Swallow TUI chain-of-thought between Kneading… and Frosting…(Ns). */
  let thinkingCtx = false;

  const flushAssistant = () => {
    if (!assistantBuf.length) return;
    const joined = assistantBuf
      .join("\n")
      .replace(/^[•●◦▪▫]\s+/gm, "- ")
      .replace(/[█░▒▓]+$/gm, "")
      .replace(/[ \t]+$/gm, "")
      .trim();
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
    if (isChromeLine(trimmed) || isChromeLine(line.trim())) continue;
    if (isInternalMonologue(trimmed)) continue;

    const cook = cookingOf(trimmed);
    if (cook) {
      flushAssistant();
      fileCtx = null;
      userCtx = null;
      const last = blocks[blocks.length - 1];
      if (last?.type === "thinking") {
        if (cook.duration) last.text = cook.duration;
      } else {
        blocks.push({ type: "thinking", text: cook.duration ?? "" });
      }
      thinkingCtx = !cook.done;
      continue;
    }
    const thinkLine = thinkingOf(trimmed);
    if (thinkLine !== null) {
      flushAssistant();
      fileCtx = null;
      userCtx = null;
      thinkingCtx = false;
      const last = blocks[blocks.length - 1];
      if (last?.type === "thinking") {
        if (thinkLine) last.text = thinkLine;
      } else {
        blocks.push({ type: "thinking", text: thinkLine });
      }
      continue;
    }
    if (thinkingCtx) {
      if (extractUserInput(trimmed) !== null) thinkingCtx = false;
      else continue;
    }

    // Fenced code opens (optionally with a language tag).
    const fence = trimmed.match(/^```\s*([\w+#.-]*)/);
    if (fence) {
      flushAssistant();
      fileCtx = null;
      userCtx = null;
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

    // Status line → weak meta separator (✻ Baked for 28s / Worked for 12s).
    const meta = metaOf(trimmed);
    if (meta !== null) {
      flushAssistant();
      fileCtx = null;
      userCtx = null;
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
      if (userRest) {
        const block: Block = { type: "user", text: userRest };
        blocks.push(block);
        userCtx = block;
      } else {
        userCtx = null;
      }
      continue;
    }

    // TUI footer/status-bar decoration → drop the whole line. The seed-style
    // footer ("▸▸ bypass permissions on (shift+tab to cycle)") starts with
    // ▸▸, which no prompt rule matches, so it still lands here and is dropped.
    if (isFooterLine(trimmed) || /^[✻※]/.test(trimmed)) {
      userCtx = null;
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
        userCtx = null;
        assistantBuf.push(body);
        continue;
      }
      flushAssistant();
      userCtx = null;
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

    if (userCtx && isUserContinuation(trimmed)) {
      // Block-level markdown (lists, URL labels, headings, bare URLs) needs a
      // blank line so marked doesn't glue them onto the title paragraph.
      const block = /^(?:[-*+] |\d+[.)] |#{1,6} |URL\s*:|https?:\/\/)/i.test(trimmed);
      userCtx.text += (block ? "\n\n" : "\n") + trimmed;
      continue;
    }
    userCtx = null;

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
  return dedupeTurns(turns);
}

/** TUI redraws the same turn many times into scrollback — keep one. */
export function dedupeTurns(turns: Turn[]): Turn[] {
  const out: Turn[] = [];
  let last = "";
  for (const t of turns) {
    const firstA = t.body.find((b) => b.type === "assistant")?.text.trim().slice(0, 80) ?? "";
    const key = JSON.stringify({ u: t.users.map((b) => b.text.trim()), a: firstA });
    if (key === last) continue;
    last = key;
    out.push(t);
  }
  return out;
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

/** `12` → `12s`; `97` → `1m 37s` (V7 F2, reference pill `14:34:12 · 1m 37s`). */
export function formatDurationSeconds(sec: number, raw: string = String(sec)): string {
  if (!Number.isFinite(sec) || sec < 60) return `${raw}s`;
  const minutes = Math.floor(sec / 60);
  const rest = Math.round(sec % 60);
  return `${minutes}m ${rest}s`;
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
      if (m) duration = formatDurationSeconds(Number(m[1]), m[1]);
    }
  }
  return { steps, files, duration };
}
