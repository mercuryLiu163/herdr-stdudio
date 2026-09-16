# -*- coding: utf-8 -*-
# V9 review fixes for MainPane.tsx (locate-based, no brittle anchors).
path = 'src/components/MainPane.tsx'
t = open(path, encoding='utf-8').read()
applied = []

# 1) metaText after hasBody
old = '  const hasBody = turn.body.length > 0 || stats.files.length > 0;'
if old in t and 'V9 review: turn meta' not in t:
    t = t.replace(old, old + '\n'
        '  // V9 review: turn meta (Worked for/Baked for) lives in the divider\n'
        '  // pill now — drop the body row to avoid double display; the pill keeps\n'
        '  // a locator-visible .sr-only copy so the V4 chat-meta contract holds.\n'
        '  const metaText = turn.body.find((b) => b.type === "meta")?.text ?? "";', 1)
    applied.append('metaText')

# 2) live branch: skip meta
old = '    turn.body.forEach((b, i) => {\n      if (b.type === "thinking") {'
if old in t:
    t = t.replace(old, '    turn.body.forEach((b, i) => {\n      if (b.type === "meta") return;\n      if (b.type === "thinking") {', 1)
    applied.append('live-skip')

# 3) settled branch: skip meta
old = '    for (const b of turn.body) bodyBlocks.push({ block: b, live: null });'
if old in t:
    t = t.replace(old, '    for (const b of turn.body) {\n      if (b.type === "meta") continue;\n      bodyBlocks.push({ block: b, live: null });\n    }', 1)
    applied.append('settled-skip')

# 4) pill: sr-only meta copy right after the duration chip span close.
#    Locate the chip span by its class, then find the enclosing fragment close.
marker = '<span className="turn-chip" title="'
if 'data-testid="chat-meta"' not in t and marker in t:
    idx = t.index(marker)
    close_idx = t.index('</span>', idx) + len('</span>')
    # after </span> comes "\n            </>\n          )}" — insert our span after </span>
    insert_at = close_idx
    span = '\n              <span className="sr-only" data-testid="chat-meta">{metaText}</span>'
    t = t[:insert_at] + span + t[insert_at:]
    applied.append('pill-meta')

# 5) chevron always ›
old = "            className={`turn-collapse ${collapsed ? \"\" : \" open\"}`}"
if old in t:
    t = t.replace(old, '            className="turn-collapse"', 1)
    applied.append('chevron')

open(path, 'w', encoding='utf-8').write(t)
print('applied:', applied)
if len(applied) < 5:
    print('WARNING: not all edits applied — inspect manually')
