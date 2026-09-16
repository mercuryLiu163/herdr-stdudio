# -*- coding: utf-8 -*-
# V9 review fixes: send-btn border, meta dedup into pill, chevron, warm-gray mapping.
import io, sys

# ---------- global.css (line-number edits, descending order) ----------
css_path = 'src/styles/global.css'
lines = open(css_path, encoding='utf-8').read().split('\n')

def setline(idx1, new):  # idx1 is 1-based
    lines[idx1 - 1] = new

# 2498: background dot → chat-dim
if 'background: var(--text-faint);' in lines[2498 - 1]:
    setline(2498, lines[2498 - 1].replace('var(--text-faint)', 'var(--chat-dim)'))
# 2470 / 2443: composer text colors
if 'color: var(--text);' in lines[2470 - 1]:
    setline(2470, lines[2470 - 1].replace('var(--text)', 'var(--chat-text)'))
if 'color: var(--text);' in lines[2443 - 1]:
    setline(2443, lines[2443 - 1].replace('var(--text)', 'var(--chat-text)'))
# 2414-ish: .send-btn default border (insert after font-weight line)
idx = 2414 - 1
if 'font-weight: 600;' in lines[idx] and 'border-color' not in lines[idx + 1]:
    lines.insert(idx + 1, '  border-color: var(--border-strong);')
# 2389 / 2378 / 2319: composer text
for n in (2389, 2378, 2319):
    if 'color: var(--text);' in lines[n - 1]:
        setline(n, lines[n - 1].replace('var(--text)', 'var(--chat-text)'))
# 2298 / 2286: composer dim
for n in (2298,):
    if 'color: var(--text-faint);' in lines[n - 1]:
        setline(n, lines[n - 1].replace('var(--text-faint)', 'var(--chat-dim)'))
if 'background: var(--text-faint);' in lines[2286 - 1]:
    setline(2286, lines[2286 - 1].replace('var(--text-faint)', 'var(--chat-dim)'))
# 1618: chat-image-missing
if 'color: var(--text-faint);' in lines[1618 - 1]:
    setline(1618, lines[1618 - 1].replace('var(--text-faint)', 'var(--chat-dim)'))
# 1475: chat-md blockquote
if 'color: var(--text-dim);' in lines[1475 - 1]:
    setline(1475, lines[1475 - 1].replace('var(--text-dim)', 'var(--chat-dim)'))
# 1467: chat-md th
if 'color: var(--text);' in lines[1467 - 1]:
    setline(1467, lines[1467 - 1].replace('var(--text)', 'var(--chat-text)'))
# 1310: tfc-chevron
if 'color: var(--text-faint);' in lines[1310 - 1]:
    setline(1310, lines[1310 - 1].replace('var(--text-faint)', 'var(--chat-dim)'))
# 1261: turn-collapse
if 'color: var(--text-faint);' in lines[1261 - 1]:
    setline(1261, lines[1261 - 1].replace('var(--text-faint)', 'var(--chat-dim)'))
# 1127: chat-thinking summary:hover
if 'color: var(--text-dim);' in lines[1127 - 1]:
    setline(1127, lines[1127 - 1].replace('var(--text-dim)', 'var(--chat-dim)'))
# 1092: chat-msg prose dim
if 'color: var(--text-dim);' in lines[1092 - 1]:
    setline(1092, lines[1092 - 1].replace('var(--text-dim)', 'var(--chat-dim)'))

# sr-only helper (for pill meta, keeps V4 chat-meta contract without double display)
lines.append('')
lines.append('/* visually hidden but locator-visible: turn meta lives inside the divider pill */')
lines.append('.sr-only {')
lines.append('  position: absolute;')
lines.append('  width: 1px;')
lines.append('  height: 1px;')
lines.append('  padding: 0;')
lines.append('  margin: -1px;')
lines.append('  overflow: hidden;')
lines.append('  clip: rect(0 0 0 0);')
lines.append('  white-space: nowrap;')
lines.append('  border: 0;')
lines.append('}')
open(css_path, 'w', encoding='utf-8').write('\n'.join(lines))
print('global.css patched')

# ---------- MainPane.tsx (anchor edits) ----------
tsx_path = 'src/components/MainPane.tsx'
t = open(tsx_path, encoding='utf-8').read()

# metaText for the turn
old = '  const hasBody = turn.body.length > 0 || stats.files.length > 0;'
new = ('  const hasBody = turn.body.length > 0 || stats.files.length > 0;\n'
       '  // V9 review: turn meta (Worked for/Baked for) now lives in the divider\n'
       '  // pill — drop the body row to avoid double display; the pill carries a\n'
       '  // locator-visible .sr-only copy so the V4 chat-meta contract holds.\n'
       '  const metaText = turn.body.find((b) => b.type === "meta")?.text ?? "";')
assert old in t
t = t.replace(old, new, 1)

# skip meta blocks in live branch
old = '    turn.body.forEach((b, i) => {\n      if (b.type === "thinking") {'
new = '    turn.body.forEach((b, i) => {\n      if (b.type === "meta") return;\n      if (b.type === "thinking") {'
assert old in t
t = t.replace(old, new, 1)

# skip meta blocks in settled branch
old = '    for (const b of turn.body) bodyBlocks.push({ block: b, live: null });'
new = '    for (const b of turn.body) {\n      if (b.type === "meta") continue;\n      bodyBlocks.push({ block: b, live: null });\n    }'
assert old in t
t = t.replace(old, new, 1)

# pill: append sr-only meta copy after duration chip
old = '''              <span className="turn-chip" title="本轮耗时">
                {stats.duration}
              </span>
            </>
          )}'''
new = '''              <span className="turn-chip" title="本轮耗时">
                {stats.duration}
              </span>
            </>
          )}
          {metaText && (
            <span className="sr-only" data-testid="chat-meta">
              {metaText}
            </span>
          )}'''
assert old in t
t = t.replace(old, new, 1)

# chevron always › (reference A); aria-expanded remains
old = '            className={`turn-collapse ${collapsed ? "" : " open"}`}'
assert old in t
t = t.replace(old, '            className="turn-collapse"', 1)

open(tsx_path, 'w', encoding='utf-8').write(t)
print('MainPane patched')
