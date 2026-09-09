import { marked } from "marked";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

/**
 * Shared markdown rendering for the chat surface (V3 F2) and the right sidebar
 * preview (V2 F2). Security baseline (unchanged from V2):
 *   - the source is HTML-escaped BEFORE marked runs, so raw markup in agent
 *     output / files can never inject elements;
 *   - anchors survive only with http(s) hrefs (opened externally via the
 *     window-open guard); everything else degrades to plain text;
 *   - highlight.js escapes its own input; we only ever hand it text content.
 */

// Register a compact language set (core build keeps the bundle small).
const LANGS: Array<[string[], Parameters<typeof hljs.registerLanguage>[1]]> = [
  [["bash", "sh", "shell", "zsh", "console"], bash],
  [["css"], css],
  [["diff", "patch"], diff],
  [["go", "golang"], go],
  [["javascript", "js", "jsx", "mjs", "cjs"], javascript],
  [["json", "jsonc"], json],
  [["markdown", "md"], markdown],
  [["python", "py"], python],
  [["rust", "rs"], rust],
  [["sql"], sql],
  [["typescript", "ts", "tsx"], typescript],
  [["xml", "html", "svg"], xml],
  [["yaml", "yml"], yaml],
];
for (const [names, def] of LANGS) for (const n of names) hljs.registerLanguage(n, def);

/** Escape raw HTML so marked output can never inject markup from the source. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Syntax-colour a code snippet. Returns safe HTML (hljs escapes the input). */
export function highlightCode(src: string, lang?: string | null): string {
  const language = (lang ?? "").trim().toLowerCase();
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(src, { language, ignoreIllegals: true }).value;
    }
    // Unknown / missing fence language: cheap auto-detect over the registered
    // subset; fall back to plain escaped text for tiny snippets.
    if (src.length >= 12) return hljs.highlightAuto(src).value;
  } catch {
    /* fall through */
  }
  return escapeHtml(src);
}

export interface RenderMarkdownOptions {
  /** Drop <img> elements (chat: images are inlined through fs:read instead). */
  stripImages?: boolean;
}

/**
 * Link guard + code colouring over marked's output. Works on a detached
 * <template> so nothing is ever attached to the live document before it has
 * been sanitised.
 */
function postProcess(html: string, opts: RenderMarkdownOptions): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  tpl.content.querySelectorAll("a").forEach((a) => {
    const href = (a.getAttribute("href") ?? "").trim();
    if (/^https?:\/\//i.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    } else {
      a.replaceWith(document.createTextNode(a.textContent ?? ""));
    }
  });
  if (opts.stripImages) {
    tpl.content.querySelectorAll("img").forEach((img) => {
      img.replaceWith(document.createTextNode(img.getAttribute("alt") ?? ""));
    });
  }
  tpl.content.querySelectorAll("pre code").forEach((code) => {
    const m = (code.getAttribute("class") ?? "").match(/language-([\w+#.-]+)/);
    code.innerHTML = highlightCode(code.textContent ?? "", m?.[1]);
    code.classList.add("hljs");
  });
  return tpl.innerHTML;
}

/** Markdown → sanitised HTML string (escaped source, guarded links, hljs code). */
export function renderMarkdown(src: string, opts: RenderMarkdownOptions = {}): string {
  const html = marked.parse(escapeHtml(src), { async: false }) as string;
  return postProcess(html, opts);
}
