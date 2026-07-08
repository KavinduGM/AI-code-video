// =====================================================================
// DETERMINISTIC, VOICEOVER-SYNCED CHART / DIAGRAM SCENES
// =====================================================================
// A middle scene whose script carries a `chart:` block is rendered here as
// a code-drawn visual INSTEAD of the plain text bands/box/marks. Four types:
//
//   'bar'     → horizontal bars (label + proportional bar + value)
//   'compare' → two-column comparison table (headers + rows)
//   'flow'    → step boxes joined by down-arrows (a process/sequence)
//   'donut'   → a proportion ring + legend (shares that sum to a whole)
//
// Same principles as syncedscenes.ts: everything is COMPUTED (palette, sizes,
// geometry) and drawn in SVG/HTML — nothing is invented at render time, so it
// renders correctly on the first pass. Each element's reveal is anchored to
// the moment its phrase is spoken (the ElevenLabs word timings that drive the
// captions), and every animation is one-pass (`fill-mode: both`, one
// iteration) so a chart can never loop or come out empty. The result is run
// through the same universal safe-zone fit the text scenes use. No Electron
// imports → directly testable with esbuild + node.
// =====================================================================

import { NINE_SIXTEEN } from '@shared/zones'
import type { ChartSpec } from '@shared/types'
import type { WordTiming } from './tts'
import { measureSafeZone, fitHtmlToSafeZone } from './safezone'
import { buildPalette, computeReveals, esc, sizeFor, type Palette } from './syncedscenes'

export interface ChartSceneArgs {
  chart: ChartSpec
  style: { colors?: string[]; fonts?: string[] } | undefined
  durationSeconds: number
  words: WordTiming[] | null
}

/** The accent cycle used to colour successive bars / segments / steps. */
function accentCycle(p: Palette): string[] {
  return [p.blue, p.gold, p.green, p.coral]
}

/** Split a compare row "left | right" into its two cells. */
function splitRow(row: string): [string, string] {
  const i = row.indexOf('|')
  if (i < 0) return [row.trim(), '']
  return [row.slice(0, i).trim(), row.slice(i + 1).trim()]
}

// --------------------------------------------------------------------
// Per-type body builders. Each returns the inner HTML for `.safe`, given the
// palette, the reveal time (seconds) for each item in order, and a delay
// helper. The heading/title reveal is handled by the caller.
// --------------------------------------------------------------------

function buildBar(chart: ChartSpec, p: Palette, itemReveals: number[], del: (t: number) => string): string {
  const data = chart.data ?? []
  const max = Math.max(1, ...data.map((d) => d.value))
  const accents = accentCycle(p)
  const rows = data
    .map((d, i) => {
      const pct = Math.max(2, Math.round((d.value / max) * 100))
      const col = accents[i % accents.length]
      const lab = sizeFor(d.label, 0.62, 30, 46, 360)
      return `        <div class="brow rev" style="${del(itemReveals[i])}">
          <div class="blabel" style="font-size:${lab}px">${esc(d.label)}</div>
          <div class="btrack"><div class="bfill" style="width:${pct}%;background:${col};${del(itemReveals[i])}"></div></div>
          <div class="bval" style="color:${col}">${esc(String(d.value))}</div>
        </div>`
    })
    .join('\n')
  return `      <div class="bars">\n${rows}\n      </div>`
}

function buildCompare(chart: ChartSpec, p: Palette, itemReveals: number[], del: (t: number) => string): string {
  const [hL, hR] = chart.headers ?? ['', '']
  const rows = (chart.rows ?? [])
    .map((r, i) => {
      const [l, rt] = splitRow(r)
      const fs = sizeFor(l.length > rt.length ? l : rt, 0.6, 28, 44, 380)
      return `        <div class="crow rev" style="${del(itemReveals[i])}">
          <div class="ccell" style="font-size:${fs}px">${esc(l)}</div>
          <div class="ccell" style="font-size:${fs}px">${esc(rt)}</div>
        </div>`
    })
    .join('\n')
  const hs = sizeFor(hL.length > hR.length ? hL : hR, 0.55, 34, 54, 420)
  return `      <div class="ctable" style="border-color:${p.blue}">
        <div class="chead" style="color:${p.gold};font-size:${hs}px">
          <div class="ccell">${esc(hL)}</div>
          <div class="ccell">${esc(hR)}</div>
        </div>
${rows}
      </div>`
}

function buildFlow(chart: ChartSpec, p: Palette, itemReveals: number[], del: (t: number) => string): string {
  const steps = chart.steps ?? []
  const accents = accentCycle(p)
  const parts: string[] = []
  steps.forEach((s, i) => {
    const col = accents[i % accents.length]
    const fs = sizeFor(s, 0.56, 30, 50, 560)
    parts.push(
      `        <div class="fstep rev" style="border-color:${col};${del(itemReveals[i])}"><span style="font-size:${fs}px">${esc(s)}</span></div>`
    )
    if (i < steps.length - 1) {
      // The connecting arrow reveals with the NEXT step.
      parts.push(
        `        <div class="farrow rev" style="${del(itemReveals[i + 1])}"><svg width="46" height="46" viewBox="0 0 24 24" fill="none"><path d="M12 4v14M6 13l6 6 6-6" stroke="${p.ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`
      )
    }
  })
  return `      <div class="flow">\n${parts.join('\n')}\n      </div>`
}

function buildDonut(chart: ChartSpec, p: Palette, itemReveals: number[], del: (t: number) => string): string {
  const data = chart.data ?? []
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const accents = accentCycle(p)
  const R = 150
  const C = 2 * Math.PI * R
  let acc = 0
  const segs: string[] = []
  const legend: string[] = []
  data.forEach((d, i) => {
    const frac = d.value / total
    const col = accents[i % accents.length]
    const arc = frac * C
    const rot = acc * 360 - 90 // start at 12 o'clock
    // NB: only the `fade` animation (opacity) here — never a transform-based
    // reveal, which would clobber the rotate() that positions the arc.
    segs.push(
      `        <circle class="seg" cx="200" cy="200" r="${R}" fill="none" stroke="${col}" stroke-width="52" stroke-dasharray="${arc.toFixed(2)} ${(C - arc).toFixed(2)}" transform="rotate(${rot.toFixed(2)} 200 200)" style="${del(itemReveals[i])}"/>`
    )
    const pctTxt = Math.round(frac * 100)
    legend.push(
      `        <div class="lrow rev" style="${del(itemReveals[i])}"><span class="swatch" style="background:${col}"></span><span class="lname">${esc(d.label)}</span><span class="lpct" style="color:${col}">${pctTxt}%</span></div>`
    )
    acc += frac
  })
  return `      <div class="donutwrap">
        <svg class="donut" width="400" height="400" viewBox="0 0 400 400">
${segs.join('\n')}
        </svg>
        <div class="legend">
${legend.join('\n')}
        </div>
      </div>`
}

/**
 * Build the complete voiceover-synced chart scene HTML. Deterministic and
 * pure. Returns null when the chart has no drawable data (so the caller can
 * fall back to the text-scene renderer).
 */
export async function buildChartSceneHtml(args: ChartSceneArgs): Promise<string | null> {
  const { chart, durationSeconds: D, words } = args
  const p = buildPalette(args.style?.colors ?? [])

  // Item texts in visual order → used to anchor each reveal to the narration.
  let itemTexts: string[]
  if (chart.type === 'compare') itemTexts = (chart.rows ?? []).map((r) => splitRow(r).join(' '))
  else if (chart.type === 'flow') itemTexts = chart.steps ?? []
  else itemTexts = (chart.data ?? []).map((d) => d.label)
  if (itemTexts.length === 0) return null

  const title = chart.title?.trim() || ''
  const reveals = computeReveals([title, ...itemTexts], words, D)
  const headReveal = reveals[0]
  const itemReveals = reveals.slice(1)
  const del = (t: number) => `animation-delay:${t.toFixed(2)}s`

  let bodyInner: string
  if (chart.type === 'bar') bodyInner = buildBar(chart, p, itemReveals, del)
  else if (chart.type === 'compare') bodyInner = buildCompare(chart, p, itemReveals, del)
  else if (chart.type === 'flow') bodyInner = buildFlow(chart, p, itemReveals, del)
  else bodyInner = buildDonut(chart, p, itemReveals, del)

  const f0 = (args.style?.fonts?.[0] ?? 'Caveat').trim()
  const f1 = (args.style?.fonts?.[1] ?? args.style?.fonts?.[0] ?? 'Poppins').trim()
  const fam = (n: string) => n.replace(/\s+/g, '+')
  const fontLink =
    f0.toLowerCase() === f1.toLowerCase()
      ? `https://fonts.googleapis.com/css2?family=${fam(f0)}:wght@600;700&display=swap`
      : `https://fonts.googleapis.com/css2?family=${fam(f0)}:wght@700&family=${fam(f1)}:wght@600;700&display=swap`

  const titleHtml = title
    ? `      <div class="ctitle rev" style="color:${p.heading};font-size:${sizeFor(title, 0.5, 56, 112, 980)}px;${del(headReveal)}">${esc(title)}</div>`
    : ''

  const m = NINE_SIXTEEN.margin
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
        display:flex;flex-direction:column;align-items:center;justify-content:center;box-sizing:border-box;gap:44px}
  .ctitle{font-family:'${f0}',cursive;font-weight:700;line-height:1.06;text-align:center;max-width:100%}

  /* bar */
  .bars{display:flex;flex-direction:column;gap:30px;width:100%}
  .brow{display:flex;align-items:center;gap:22px;width:100%}
  .blabel{color:${p.ink};font-weight:700;flex:0 0 300px;text-align:right;line-height:1.12}
  .btrack{flex:1 1 auto;height:64px;background:rgba(255,255,255,.08);border-radius:14px;overflow:hidden}
  .bfill{height:100%;border-radius:14px;transform-origin:left center;transform:scaleX(0);animation:grow .65s cubic-bezier(.2,.7,.3,1) both;animation-iteration-count:1}
  .bval{flex:0 0 auto;font-weight:800;font-size:40px;min-width:64px;text-align:left}

  /* compare */
  .ctable{border:4px solid ${p.blue};border-radius:24px;overflow:hidden;width:100%;box-sizing:border-box}
  .chead,.crow{display:grid;grid-template-columns:1fr 1fr}
  .chead{font-weight:800;border-bottom:3px solid ${p.blue}}
  .crow{color:${p.ink};font-weight:700;border-top:2px solid rgba(255,255,255,.12)}
  .ccell{padding:22px 26px;text-align:center;line-height:1.16}
  .chead .ccell + .ccell,.crow .ccell + .ccell{border-left:2px solid rgba(255,255,255,.12)}

  /* flow */
  .flow{display:flex;flex-direction:column;align-items:center;gap:14px;width:100%}
  .fstep{border:4px solid;border-radius:22px;padding:24px 34px;color:${p.ink};font-weight:700;text-align:center;
         line-height:1.16;max-width:82%;box-sizing:border-box}
  .farrow{display:flex;align-items:center;justify-content:center}

  /* donut */
  .donutwrap{display:flex;flex-direction:column;align-items:center;gap:36px}
  .donut{transform:rotate(0deg)}
  .seg{opacity:0;animation:fade .5s ease both;animation-iteration-count:1}
  .legend{display:flex;flex-direction:column;gap:16px}
  .lrow{display:flex;align-items:center;gap:18px;font-weight:700;color:${p.ink};font-size:40px}
  .swatch{width:34px;height:34px;border-radius:8px;flex:0 0 auto}
  .lname{flex:1 1 auto}
  .lpct{font-weight:800}

  .rev{opacity:0;animation:revIn .5s cubic-bezier(.2,.7,.3,1) both;animation-iteration-count:1}
  @keyframes revIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  @keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  @keyframes fade{from{opacity:0}to{opacity:1}}
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-width="1080" data-height="1920" data-duration="${d}">
  <div class="safe">
${titleHtml}
${bodyInner}
  </div>
</div>
</body>
</html>`

  // Universal safe-zone insurance — the same translate+scale fit the text
  // scenes use, so a wide table / tall flow still lands inside the safe area.
  try {
    const measurement = await measureSafeZone(html, D)
    if (measurement.measured && !measurement.ok) {
      const fit = fitHtmlToSafeZone(html, measurement)
      if (fit.fitted) html = fit.html
    }
  } catch {
    /* raw chart is conservatively sized */
  }
  return html
}
