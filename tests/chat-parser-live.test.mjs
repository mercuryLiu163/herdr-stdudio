import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseTranscript, groupTurns, extractComposerStatus } from "../src/chat-parser.ts";

const dump = (name) => path.join("tests", "artifacts", "live-dump", name);

test("live ZCODE+Claude pane: no cooking chrome, 你好 is a user turn", async (t) => {
  const p = dump("w2_p6.txt");
  if (!fs.existsSync(p)) return t.skip("no live dump");
  const blocks = parseTranscript(fs.readFileSync(p, "utf8"));
  const blob = blocks.map((b) => b.text).join("\n");
  assert.equal(/Kneading|Frosting|Token usage/i.test(blob), false);
  assert.ok(blocks.some((b) => b.type === "user" && b.text.includes("你好")));
  assert.ok(blocks.some((b) => b.type === "assistant" && /地图编辑器/.test(b.text)));
  const turns = groupTurns(blocks);
  assert.ok(turns.length <= 12, "redraws should collapse, got " + turns.length);
});

test("live splash pane parses to empty (logo is chrome)", async (t) => {
  const p = dump("w2_p4.txt");
  if (!fs.existsSync(p)) return t.skip("no live dump");
  const blocks = parseTranscript(fs.readFileSync(p, "utf8"));
  assert.equal(blocks.length, 0);
});

test("Grok splash / footer is chrome, status extracted for composer", async () => {
  const splash = [
    "Grok Build 1.0.30 | Thanks for trying Grok Build, give feedback with /feedback!",
    "New worktree ctrl+w | Resume session ctrl+r | Changelog",
    "Quit ctrl+q",
    "\u28ff\u28ff\u28ff\u28ff\u28ff art",
    "╭────────────────────────────────────────────╮",
    "│ ❯                                          │",
    "╰──────────────── Grok 4.6 (medium) · always-approve ─╯",
    "Shift+Tab:mode  │  Ctrl+x:shortcuts",
  ].join("\n");
  const blocks = parseTranscript(splash);
  assert.equal(
    blocks.filter((b) => /Grok Build|always-approve|New worktree|Quit ctrl/i.test(b.text)).length,
    0,
  );
  const bar = extractComposerStatus(splash);
  assert.equal(bar.model, "Grok 4.6");
  assert.equal(bar.effort, "medium");
  assert.equal(bar.mode, "always-approve");
});
