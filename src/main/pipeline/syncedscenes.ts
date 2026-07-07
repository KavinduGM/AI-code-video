// =====================================================================
// DETERMINISTIC, VOICEOVER-SYNCED MIDDLE SCENES
// =====================================================================
// The AI middle-scene generator (generateSceneHtml) invents fresh HTML +
// animation every render, which is where the loops / empty boxes / sparse
// frames come from. This module builds the three middle-scene types
// ENTIRELY in code — the same proven approach as the intro/outro cards
// (cards.ts) and the static fallback (buildStaticSceneCard):
//
//   scene "bands"  → heading + plain text lines
//   scene "box"    → heading + a code-drawn rounded box of lines + a line
//   scene "marks"  → heading + rows of ✓ / ✗ marks + one filled ★ + labels
//
// Everything is computed: the scene type, the palette, the marks, the font
// sizes, and — the whole point — the REVEAL TIMING. Each line's fade-in is
// anchored to the exact moment its phrase is spoken, using the per-word
// timings ElevenLabs already returns (the same data that drives the karaoke
// captions). No AI in the loop, so it renders correctly on the first pass;
// every reveal ends fully visible (fill-mode: both, one pass) so it can
// never loop or come out empty. No Electron imports → directly testable.
// =====================================================================

import { NINE_SIXTEEN } from '@shared/zones'
import type { WordTiming } from './tts'
import { measureSafeZone, fitHtmlToSafeZone } from './safezone'

export interface SyncedSceneStyle {
  colors?: string[]
  fonts?: string[]
}

export interface SyncedSceneArgs {
  explainer: string
  style: SyncedSceneStyle | undefined
  durationSeconds: number
  words: WordTiming[] | null
}

// ---- small local helpers (kept local so this file stays dependency-light) ----
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function norm(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9+]/g, '')
}
function clampN(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
/** The quoted display lines of a scene (each on its own line in the explainer). */
function extractDisplayLines(explainer: string): string[] {
  return Array.from(explainer.matchAll(/^\s*"([^"\n]{2,80})"\s*$/gm))
    .map((m) => m[1].trim())
    .filter(Boolean)
}
function rgbOf(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function lumaOf(hex: string): number | null {
  const t = rgbOf(hex)
  return t ? 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2] : null
}

// --------------------------------------------------------------------
// PALETTE — classify the script's colors into named roles by hue, so the
// explainer's color words ("in blue", "coral cross", "golden star") map to
// the actual palette. Falls back to the dark-navy chemistry defaults.
// --------------------------------------------------------------------
interface Palette {
  bg: string
  ink: string
  heading: string
  blue: string
  coral: string
  gold: string
  green: string
}
function buildPalette(colors: string[]): Palette {
  const valid = colors.filter((c) => lumaOf(c) !== null)
  const byLumaAsc = valid.slice().sort((a, b) => (lumaOf(a) as number) - (lumaOf(b) as number))
  const bg = byLumaAsc[0] ?? '#0E1A2B'
  const ink = byLumaAsc[byLumaAsc.length - 1] ?? '#F4F7FB'
  const pick = (score: (r: number, g: number, b: number) => number, fallback: string): string => {
    let best: string | null = null
    let bestScore = 8 // require a clear hue, not a near-gray
    for (const c of valid) {
      if (c === bg || c === ink) continue
      const t = rgbOf(c)
      if (!t) continue
      const s = score(t[0], t[1], t[2])
      if (s > bestScore) {
        bestScore = s
        best = c
      }
    }
    return best ?? fallback
  }
  const blue = pick((r, g, b) => b - Math.max(r, g), '#3B82F6')
  const coral = pick((r, g, b) => r - g, '#FF6B6B') // red clearly above green
  const gold = pick((r, g, b) => Math.min(r, g) - b, '#FFD166') // r & g high, b low
  const green = pick((r, g, b) => g - Math.max(r, b), '#3BB273')
  return { bg, ink, heading: gold, blue, coral, gold, green }
}
function colorByName(name: string, p: Palette): string {
  const n = name.toLowerCase()
  if (/blue|cyan|teal|navy|azure|sky/.test(n)) return p.blue
  if (/coral|red|orange|pink|rose|crimson|scarlet/.test(n)) return p.coral
  if (/yellow|gold|amber|golden|butter/.test(n)) return p.gold
  if (/green|lime|emerald|mint/.test(n)) return p.green
  if (/white|off-white|cream|ivory|off white/.test(n)) return p.ink
  return p.ink
}

// --------------------------------------------------------------------
// PARSE the explainer → scene kind, heading, items (with per-item mark +
// box membership), and inline "word" in <color> emphasis.
// --------------------------------------------------------------------
type Mark = 'check' | 'cross' | 'star' | null
interface Item {
  text: string
  mark: Mark
  markColor: string
  inBox: boolean
}
interface Parsed {
  kind: 'bands' | 'box' | 'marks'
  heading: string | null
  headingColor: string
  items: Item[]
  emphasis: { word: string; color: string }[]
}
function colorAdj(desc: string, kind: Mark, p: Palette): string {
  const cm = /(blue|coral|red|orange|golden|gold|yellow|green|cyan|teal|white)/i.exec(desc)
  if (cm) return colorByName(cm[1], p)
  return kind === 'cross' ? p.coral : kind === 'star' ? p.gold : p.blue
}
function parseScene(explainer: string, p: Palette): Parsed {
  const quoteRe = /^\s*"([^"\n]{2,80})"\s*$/
  const blocks: { text: string; desc: string }[] = []
  let buf: string[] = []
  for (const ln of explainer.split('\n')) {
    const q = quoteRe.exec(ln)
    if (q) {
      blocks.push({ text: q[1].trim(), desc: buf.join(' ') })
      buf = []
    } else if (ln.trim()) {
      buf.push(ln.trim())
    }
  }

  const low = explainer.toLowerCase()
  const kind: Parsed['kind'] = /\bstar\b|check ?mark|cross ?mark|\btick\b/.test(low)
    ? 'marks'
    : /\bbox\b|rectang/.test(low)
      ? 'box'
      : 'bands'

  // Inline emphasis: `"gives" in blue and "takes" in coral`.
  const emphasis: { word: string; color: string }[] = []
  for (const m of explainer.matchAll(/"([^"\n]{1,32})"\s+in\s+([a-z-]+)/gi)) {
    const col = colorByName(m[2], p)
    for (const w of m[1].split(/\s+/)) {
      const nw = norm(w)
      if (nw) emphasis.push({ word: nw, color: col })
    }
  }

  const heading = blocks.length ? blocks[0].text : null
  const headDesc = (blocks[0]?.desc ?? '').toLowerCase()
  const headCm = /(golden yellow|yellow|gold|blue|coral|red|green|white|cream)/.exec(headDesc)
  const headingColor = headCm ? colorByName(headCm[1], p) : p.heading

  const items: Item[] = []
  let boxActive = false
  for (let i = 1; i < blocks.length; i++) {
    const d = blocks[i].desc.toLowerCase()
    if (/box|rectang/.test(d)) boxActive = true
    else if (/\b(lower|bottom|below|band|middle|top|hook|memory)\b/.test(d)) boxActive = false

    let mark: Mark = null
    let markColor = p.ink
    if (kind === 'marks') {
      if (/cross|✗|\bx mark\b|wrong|trap|bait/.test(d)) {
        mark = 'cross'
        markColor = colorAdj(d, 'cross', p)
      } else if (/star/.test(d)) {
        mark = 'star'
        markColor = colorAdj(d, 'star', p)
      } else if (/check|tick|✓/.test(d)) {
        mark = 'check'
        markColor = colorAdj(d, 'check', p)
      } else {
        mark = 'check'
        markColor = p.blue
      }
    }
    items.push({ text: blocks[i].text, mark, markColor, inBox: kind === 'box' ? boxActive : false })
  }
  return { kind, heading, headingColor, items, emphasis }
}

// --------------------------------------------------------------------
// TIMING — anchor each line's reveal to the moment its phrase is spoken.
// --------------------------------------------------------------------
const STOP = new Set(
  ('a,an,the,and,or,is,are,was,were,to,of,in,on,for,it,its,that,this,with,so,you,your,our,will,' +
    'not,but,at,as,by,be,they,them,their,do,does,than,then,into,from,out,up,down,all,any,one,two,' +
    'three,no,yes,if,when,every,each,also,just,very,more,most,here,there,what,how,why,who').split(',')
)
function anchorsFor(text: string): string[] {
  const words = text.split(/\s+/).map(norm).filter((w) => w.length >= 4 && !STOP.has(w))
  return words.length ? words : text.split(/\s+/).map(norm).filter(Boolean)
}
function stemMatch(anchor: string, spoken: string): boolean {
  if (anchor === spoken) return true
  if (anchor.length >= 4 && spoken.length >= 4 && (anchor.startsWith(spoken) || spoken.startsWith(anchor)))
    return true
  return false
}
/**
 * reveal time (seconds) for each element, in visual order:
 *   elementTexts[0] = heading (reveals at the start), rest = body lines.
 * With word timings, a line reveals just before its first anchor word is
 * spoken; without them, it falls back to an even spread across the clip.
 */
export function computeReveals(elementTexts: string[], words: WordTiming[] | null, D: number): number[] {
  const n = elementTexts.length
  const first = 0.3
  const last = Math.max(first, D - 0.5)
  const out = new Array<number>(n).fill(first)
  if (n === 0) return out

  if (!words || words.length === 0) {
    const step = n > 1 ? Math.min(0.95, (Math.min(last, D * 0.72) - first) / (n - 1)) : 0
    for (let i = 0; i < n; i++) out[i] = Math.min(first + i * step, last)
    return out
  }

  const spoken = words.map((w) => ({ start: Math.max(0, w.start), n: norm(w.text) }))
  out[0] = Math.min(first, last)
  let cursor = 0
  let prev = out[0]
  for (let i = 1; i < n; i++) {
    const anchors = anchorsFor(elementTexts[i])
    let hit: number | null = null
    for (let j = cursor; j < spoken.length; j++) {
      if (anchors.some((a) => stemMatch(a, spoken[j].n))) {
        hit = spoken[j].start
        cursor = j + 1
        break
      }
    }
    const remaining = n - i
    let reveal = hit != null ? hit - 0.12 : prev + Math.max(0.5, (last - prev) / Math.max(1, remaining))
    reveal = Math.max(reveal, prev + 0.25)
    reveal = Math.min(reveal, last)
    out[i] = reveal
    prev = reveal
  }
  return out
}

// --------------------------------------------------------------------
// RENDER
// --------------------------------------------------------------------
function markSvg(mark: Mark, color: string, popDelay?: string): string {
  if (mark === 'check')
    return `<span class="mk"><svg width="70" height="70" viewBox="0 0 24 24" fill="none"><path d="M4 13l5 5L20 5" stroke="${color}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`
  if (mark === 'cross')
    return `<span class="mk"><svg width="68" height="68" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="${color}" stroke-width="3.4" stroke-linecap="round"/></svg></span>`
  if (mark === 'star')
    return `<span class="mk"><svg class="pop" style="animation-delay:${popDelay ?? '0s'}" width="82" height="82" viewBox="0 0 24 24"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 18.6 5.9 21.4l1.4-6.8L2.2 9.9l6.9-.8z" fill="${color}"/></svg></span>`
  return ''
}
function renderText(text: string, emphasis: { word: string; color: string }[]): string {
  if (emphasis.length === 0) return esc(text)
  return text
    .split(/(\s+)/)
    .map((tok) => {
      if (/^\s+$/.test(tok)) return tok
      const e = emphasis.find((x) => x.word === norm(tok))
      return e ? `<span style="color:${e.color}">${esc(tok)}</span>` : esc(tok)
    })
    .join('')
}
function sizeFor(text: string, factor: number, lo: number, hi: number, widthPx: number): number {
  return clampN(Math.floor(widthPx / (factor * Math.max(4, text.length))), lo, hi)
}

/**
 * Build the complete voiceover-synced scene HTML. Deterministic and pure.
 * Returns null when the explainer has no quoted display lines (so the caller
 * can fall back to the AI generator).
 */
export async function buildSyncedSceneHtml(args: SyncedSceneArgs): Promise<string | null> {
  const { explainer, durationSeconds: D, words } = args
  const displayLines = extractDisplayLines(explainer)
  if (displayLines.length === 0) return null

  const p = buildPalette(args.style?.colors ?? [])
  const parsed = parseScene(explainer, p)

  const f0 = (args.style?.fonts?.[0] ?? 'Caveat').trim()
  const f1 = (args.style?.fonts?.[1] ?? args.style?.fonts?.[0] ?? 'Poppins').trim()
  const fam = (n: string) => n.replace(/\s+/g, '+')
  const fontLink =
    f0.toLowerCase() === f1.toLowerCase()
      ? `https://fonts.googleapis.com/css2?family=${fam(f0)}:wght@600;700&display=swap`
      : `https://fonts.googleapis.com/css2?family=${fam(f0)}:wght@700&family=${fam(f1)}:wght@600;700&display=swap`

  // Reveal times in visual order: heading, then items in explainer order.
  const elementTexts = [parsed.heading ?? '', ...parsed.items.map((it) => it.text)]
  const reveals = computeReveals(elementTexts, words, D)
  const headReveal = reveals[0]
  const itemReveals = reveals.slice(1)
  const del = (t: number) => `animation-delay:${t.toFixed(2)}s`

  // Box membership (fall back to plain bands if a "box" scene parsed no members).
  let boxIdx: number[] = []
  if (parsed.kind === 'box') {
    boxIdx = parsed.items.map((it, i) => (it.inBox ? i : -1)).filter((i) => i >= 0)
  }
  const useBox = parsed.kind === 'box' && boxIdx.length > 0

  const m = NINE_SIXTEEN.margin
  const body: string[] = []

  if (parsed.heading) {
    const hs = sizeFor(parsed.heading, 0.5, 60, 128, 1000)
    body.push(
      `      <div class="hd rev" style="font-size:${hs}px;color:${parsed.headingColor};${del(headReveal)}">${esc(parsed.heading)}</div>`
    )
  }

  if (parsed.kind === 'marks') {
    parsed.items.forEach((it, i) => {
      const fs = sizeFor(it.text, 0.52, 38, 66, 760)
      const mk = markSvg(it.mark, it.markColor, del(itemReveals[i]).replace('animation-delay:', ''))
      body.push(
        `      <div class="row rev" style="${del(itemReveals[i])}">${mk}<span class="mt" style="font-size:${fs}px">${renderText(it.text, parsed.emphasis)}</span></div>`
      )
    })
  } else if (useBox) {
    const boxSet = new Set(boxIdx)
    let boxEmitted = false
    parsed.items.forEach((it, i) => {
      if (boxSet.has(i)) {
        if (!boxEmitted) {
          boxEmitted = true
          const boxReveal = Math.max(0.2, Math.min(...boxIdx.map((j) => itemReveals[j])) - 0.1)
          const inner = boxIdx
            .map((j) => {
              const fs = sizeFor(parsed.items[j].text, 0.52, 40, 74, 820)
              return `        <div class="bx rev" style="font-size:${fs}px;${del(itemReveals[j])}">${renderText(parsed.items[j].text, parsed.emphasis)}</div>`
            })
            .join('\n')
          body.push(
            `      <div class="box rev" style="border-color:${p.blue};${del(boxReveal)}">\n${inner}\n      </div>`
          )
        }
        // other box members already emitted inside the box
      } else {
        const fs = sizeFor(it.text, 0.52, 44, 88, 940)
        body.push(
          `      <div class="ln rev" style="font-size:${fs}px;${del(itemReveals[i])}">${renderText(it.text, parsed.emphasis)}</div>`
        )
      }
    })
  } else {
    // bands (also the fallback for a box scene with no detected members)
    parsed.items.forEach((it, i) => {
      const fs = sizeFor(it.text, 0.52, 44, 90, 940)
      body.push(
        `      <div class="ln rev" style="font-size:${fs}px;${del(itemReveals[i])}">${renderText(it.text, parsed.emphasis)}</div>`
      )
    })
  }

  const gap = parsed.items.length + 1 >= 5 ? 30 : 40
  const d = D.toFixed(3)
  let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="${fontLink}" rel="stylesheet">
<style>
  html,body{margin:0;padding:0}
  #stage{position:relative;width:1080px;height:1920px;overflow:hidden;background:${p.bg};font-family:'${f1}',system-ui,sans-serif}
  .safe{position:absolute;left:${m.left}px;right:${m.right}px;top:${m.top}px;bottom:${m.bottom}px;
        display:flex;flex-direction:column;align-items:center;justify-content:center;box-sizing:border-box;gap:${gap}px}
  .hd{font-family:'${f0}',cursive;font-weight:700;line-height:1.05;text-align:center;max-width:100%;white-space:nowrap}
  .ln{color:${p.ink};font-weight:700;line-height:1.18;text-align:center;max-width:100%;white-space:nowrap}
  .box{border:4px solid ${p.blue};border-radius:26px;padding:26px 40px;display:flex;flex-direction:column;
       align-items:center;gap:18px;max-width:100%;box-sizing:border-box}
  .bx{color:${p.ink};font-weight:700;line-height:1.18;text-align:center;white-space:nowrap;max-width:100%}
  .row{display:flex;align-items:center;gap:22px;max-width:100%}
  .mk{flex:0 0 auto;display:flex;align-items:center;justify-content:center}
  .mt{color:${p.ink};font-weight:700;line-height:1.16;text-align:left;white-space:nowrap}
  .rev{opacity:0;animation:revIn .5s cubic-bezier(.2,.7,.3,1) both;animation-iteration-count:1}
  .pop{animation:pop .55s cubic-bezier(.2,.9,.3,1.35) both;animation-iteration-count:1}
  @keyframes revIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  @keyframes pop{0%{transform:scale(.4)}70%{transform:scale(1.14)}100%{transform:scale(1)}}
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-width="1080" data-height="1920" data-duration="${d}">
  <div class="safe">
${body.join('\n')}
  </div>
</div>
</body>
</html>`

  // Safe-zone insurance: the universal translate+scale fit guarantees the
  // box / marks / long lines sit inside the safe area (same step the static
  // card uses). Best-effort — the in-code sizing is already conservative.
  try {
    const measurement = await measureSafeZone(html, D)
    if (measurement.measured && !measurement.ok) {
      const fit = fitHtmlToSafeZone(html, measurement)
      if (fit.fitted) html = fit.html
    }
  } catch {
    /* raw card is conservatively sized */
  }
  return html
}
