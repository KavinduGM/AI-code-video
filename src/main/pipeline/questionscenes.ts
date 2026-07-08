// =====================================================================
// DETERMINISTIC QUESTION-SHORT SCENES (quiz format)
// =====================================================================
// Renders the three middle scenes of a QUESTION short entirely in code,
// synced to the voiceover with the ElevenLabs word timings:
//
//   scene 0 — the question + lettered options revealed one by one, then a
//             "guess the answer" prompt and a 5-4-3-2-1 COUNTDOWN synced to
//             the spoken count (the scene-0 voiceover ends by counting down).
//   scene 1 — the same options with the CORRECT one highlighted (green
//             border + check), revealed as the voice says the answer, then
//             the short explanation of why it is right.
//   scene 2 — a clean screen that reveals, one at a time, each WRONG option
//             with a short reason it is wrong.
//
// One-pass reveals (fill-mode: both) → nothing loops or ends empty. The
// countdown is deterministic CSS, so the 5 seconds are exact. Reuses the
// palette / sizing / safe-zone fit from the concept renderer.
// =====================================================================

import { NINE_SIXTEEN } from '@shared/zones'
import type { WordTiming } from './tts'
import type { QuestionSpec } from '@shared/types'
import { measureSafeZone, fitHtmlToSafeZone } from './safezone'
import { buildPalette, type Palette, esc, norm, sizeFor, type SyncedSceneStyle } from './syncedscenes'
import { optionLetter } from './docdetect'

export interface QuestionSceneArgs {
  question: QuestionSpec
  sceneIndex: number // 0 = ask+countdown, 1 = reveal, 2 = why-wrong
  style: SyncedSceneStyle | undefined
  durationSeconds: number
  words: WordTiming[] | null
}

// ---- word-anchor helpers (local copies so this file stays self-contained) ----
const STOP = new Set(
  ('a,an,the,and,or,is,are,was,were,to,of,in,on,for,it,its,that,this,with,so,you,your,our,will,' +
    'not,but,at,as,by,be,they,them,their,do,does,than,then,into,from,out,up,down,all,any,one,two,' +
    'three,no,yes,if,when,every,each,also,just,very,more,most,here,there,what,how,why,who,which').split(',')
)
function anchorsFor(text: string): string[] {
  const w = text.split(/\s+/).map(norm).filter((x) => x.length >= 4 && !STOP.has(x))
  return w.length ? w : text.split(/\s+/).map(norm).filter(Boolean)
}
function stemMatch(a: string, s: string): boolean {
  if (a === s) return true
  return a.length >= 4 && s.length >= 4 && (a.startsWith(s) || s.startsWith(a))
}
interface Spoken {
  start: number
  n: string
}
function spokenOf(words: WordTiming[] | null): Spoken[] {
  return (words ?? []).map((w) => ({ start: Math.max(0, w.start), n: norm(w.text) }))
}
/**
 * Reveal time per text item, anchored to the moment its first distinctive word
 * is spoken (monotonic), with an even-spread fallback when there are no timings.
 */
function anchorReveals(
  texts: string[],
  spoken: Spoken[],
  D: number,
  opt: { start?: number; last?: number; spreadEnd?: number; fromIdx?: number } = {}
): number[] {
  const start = opt.start ?? 0.3
  const last = opt.last ?? Math.max(start, D - 0.5)
  const n = texts.length
  const out = new Array<number>(n).fill(start)
  if (spoken.length === 0) {
    const span = opt.spreadEnd ?? D * 0.72
    const step = n > 1 ? Math.min(0.95, (Math.min(last, span) - start) / (n - 1)) : 0
    for (let i = 0; i < n; i++) out[i] = Math.min(start + i * step, last)
    return out
  }
  let cursor = opt.fromIdx ?? 0
  let prev = start - 0.25
  for (let i = 0; i < n; i++) {
    const anchors = anchorsFor(texts[i])
    let hit: number | null = null
    let hitIdx = cursor
    for (let j = cursor; j < spoken.length; j++) {
      if (anchors.some((a) => stemMatch(a, spoken[j].n))) {
        hit = spoken[j].start
        hitIdx = j + 1
        break
      }
    }
    let r = hit != null ? hit - 0.1 : prev + Math.max(0.45, (last - prev) / Math.max(1, n - i))
    r = Math.max(r, prev + 0.25, start)
    r = Math.min(r, last)
    out[i] = r
    prev = r
    if (hit != null) cursor = hitIdx
  }
  return out
}

const NUMWORDS: Record<number, string[]> = {
  5: ['five', '5'],
  4: ['four', '4'],
  3: ['three', '3'],
  2: ['two', '2'],
  1: ['one', '1']
}
/** The five countdown reveal times (5→1), synced to the spoken count in the tail. */
function countdownTimes(spoken: Spoken[], D: number): number[] {
  const order = [5, 4, 3, 2, 1]
  const tailStart = D * 0.45
  const found: Record<number, number> = {}
  for (const n of order) {
    for (let j = spoken.length - 1; j >= 0; j--) {
      if (spoken[j].start >= tailStart && NUMWORDS[n].includes(spoken[j].n)) {
        found[n] = spoken[j].start
        break
      }
    }
  }
  const anyFound = order.some((n) => found[n] != null)
  const times: Record<number, number> = {}
  if (!anyFound) {
    const s = Math.max(0.1, D - 5.0)
    order.forEach((n, i) => (times[n] = s + i))
  } else {
    // anchor to the first found number, space the rest 1s apart from it
    let refIdx = 0
    while (found[order[refIdx]] == null) refIdx++
    const refT = found[order[refIdx]]
    order.forEach((n, i) => {
      times[n] = found[n] != null ? found[n] : refT + (i - refIdx)
    })
  }
  return order.map((n) => Math.max(0.1, Math.min(D - 0.25, times[n])))
}

// ---- markup helpers ----
function fontsOf(style: SyncedSceneStyle | undefined): { main: string; link: string } {
  const main = (style?.fonts?.[1] ?? style?.fonts?.[0] ?? 'Poppins').trim()
  const fam = main.replace(/\s+/g, '+')
  return { main, link: `https://fonts.googleapis.com/css2?family=${fam}:wght@600;700;800&display=swap` }
}
const CHECK_SVG = (color: string) =>
  `<svg width="46" height="46" viewBox="0 0 24 24" fill="none"><path d="M4 13l5 5L20 5" stroke="${color}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const CROSS_SVG = (color: string) =>
  `<svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="${color}" stroke-width="3.4" stroke-linecap="round"/></svg>`

function del(t: number): string {
  return `animation-delay:${t.toFixed(2)}s`
}

/** Wrap built body HTML in the #stage scaffold + shared reveal CSS, then fit. */
async function frame(body: string, p: Palette, main: string, link: string, D: number, extraCss: string): Promise<string> {
  const m = NINE_SIXTEEN.margin
  let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="${link}" rel="stylesheet">
<style>
  html,body{margin:0;padding:0}
  #stage{position:relative;width:1080px;height:1920px;overflow:hidden;background:${p.bg};font-family:'${main}',system-ui,sans-serif}
  .safe{position:absolute;left:${m.left}px;right:${m.right}px;top:${m.top}px;bottom:${m.bottom}px;
        display:flex;flex-direction:column;align-items:center;justify-content:center;box-sizing:border-box;gap:26px}
  .q{color:${p.gold};font-weight:800;line-height:1.12;text-align:center;max-width:100%}
  .opt{position:relative;display:flex;align-items:center;gap:18px;width:100%;max-width:900px;box-sizing:border-box;
       padding:16px 24px;border:3px solid ${p.blue};border-radius:18px}
  .ol{flex:0 0 auto;width:60px;height:60px;border-radius:14px;display:flex;align-items:center;justify-content:center;
      font-weight:800;background:${p.blue};color:${p.bg}}
  .otext{flex:1;text-align:left;color:${p.ink};font-weight:700;line-height:1.14}
  .hl{position:absolute;inset:-3px;border:5px solid ${p.green};border-radius:18px;opacity:0;
      animation:hlIn .45s ease-out both;animation-iteration-count:1;pointer-events:none}
  .tick{position:absolute;right:20px;top:50%;transform:translateY(-50%);opacity:0;
        animation:revIn .45s ease-out both;animation-iteration-count:1}
  .prompt{color:${p.coral};font-weight:800;text-align:center;line-height:1.1}
  .cd{position:relative;width:100%;height:220px}
  .cdn{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;
       color:${p.gold};font-weight:800;font-size:190px;animation:cdflash 1s ease-out both;animation-iteration-count:1}
  .expl{color:${p.ink};font-weight:700;text-align:center;line-height:1.2;max-width:920px}
  .wrow{width:100%;max-width:920px;box-sizing:border-box;border-left:6px solid ${p.coral};padding:8px 0 8px 22px;text-align:left}
  .wq{display:flex;align-items:center;gap:14px;color:${p.ink};font-weight:800;line-height:1.14}
  .wmk{flex:0 0 auto}
  .wreason{color:${p.ink};opacity:.86;font-weight:600;line-height:1.16;margin-top:6px}
  .rev{opacity:0;animation:revIn .5s cubic-bezier(.2,.7,.3,1) both;animation-iteration-count:1}
  @keyframes revIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  @keyframes hlIn{from{opacity:0;transform:scale(1.04)}to{opacity:1;transform:scale(1)}}
  @keyframes cdflash{0%{opacity:0;transform:scale(.55)}15%{opacity:1;transform:scale(1)}80%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.12)}}
${extraCss}
</style>
</head>
<body>
<div id="stage" data-composition-id="main" data-width="1080" data-height="1920" data-duration="${D.toFixed(3)}">
  <div class="safe">
${body}
  </div>
</div>
</body>
</html>`
  try {
    const meas = await measureSafeZone(html, D)
    if (meas.measured && !meas.ok) {
      const fit = fitHtmlToSafeZone(html, meas)
      if (fit.fitted) html = fit.html
    }
  } catch {
    /* conservatively sized already */
  }
  return html
}

function optionRow(q: QuestionSpec, i: number, revealDelay: number, highlight: boolean, p: Palette, showTextSize: number): string {
  const letter = optionLetter(i)
  const hlDelay = revealDelay // for scene 1 the highlight time is passed as revealDelay
  const parts: string[] = []
  if (highlight) {
    parts.push(`<i class="hl" style="${del(hlDelay)}"></i>`)
  }
  parts.push(`<span class="ol"${highlight ? ` style="background:${p.green};color:${p.bg}"` : ''}>${letter}</span>`)
  parts.push(`<span class="otext" style="font-size:${showTextSize}px">${esc(q.options[i])}</span>`)
  if (highlight) {
    parts.push(`<span class="tick" style="${del(hlDelay)}">${CHECK_SVG(p.green)}</span>`)
  }
  return parts.join('')
}

/**
 * Build one quiz scene. Deterministic + pure (aside from the best-effort
 * safe-zone measure). Returns null only if the question is unusable.
 */
export async function buildQuestionSceneHtml(args: QuestionSceneArgs): Promise<string | null> {
  const { question: q, sceneIndex, durationSeconds: D, words } = args
  if (!q || !q.options || q.options.length < 2) return null
  const p = buildPalette(args.style?.colors ?? [])
  const { main, link } = fontsOf(args.style)
  const spoken = spokenOf(words)
  const body: string[] = []

  if (sceneIndex === 0) {
    // Question + options revealed one by one + guess prompt + countdown.
    const qSize = sizeFor(q.ask, 0.5, 44, 92, 980)
    body.push(`      <div class="q rev" style="font-size:${qSize}px;${del(0.3)}">${esc(q.ask)}</div>`)

    // options anchored to their spoken keywords, finishing before the count.
    const optLast = Math.max(1.0, D - 6.0)
    const optReveals = anchorReveals(q.options, spoken, D, { start: 0.6, last: optLast, spreadEnd: D * 0.55 })
    q.options.forEach((_, i) => {
      const os = sizeFor(q.options[i], 0.5, 34, 60, 720)
      body.push(
        `      <div class="opt rev" style="${del(optReveals[i])}">${optionRow(q, i, 0, false, p, os)}</div>`
      )
    })

    // "Guess the answer" prompt, anchored to the spoken cue or just before the count.
    const cd = countdownTimes(spoken, D)
    const promptAt = Math.max(...optReveals) + 0.4
    const promptTime = Math.min(promptAt, Math.max(0.6, cd[0] - 1.0))
    body.push(`      <div class="prompt rev" style="font-size:56px;${del(promptTime)}">Guess the answer</div>`)

    // 5-4-3-2-1 countdown, synced to the spoken count in the voiceover tail.
    const nums = [5, 4, 3, 2, 1]
    const cdSpans = nums
      .map((n, i) => `        <span class="cdn" style="${del(cd[i])}">${n}</span>`)
      .join('\n')
    body.push(`      <div class="cd">\n${cdSpans}\n      </div>`)
  } else if (sceneIndex === 1) {
    // Reveal: question small on top, options with the correct one highlighted,
    // then the explanation.
    const qSize = sizeFor(q.ask, 0.5, 36, 64, 980)
    body.push(`      <div class="q rev" style="font-size:${qSize}px;${del(0.25)}">${esc(q.ask)}</div>`)

    // The correct highlight lands when the voice names the answer.
    const answerAnchor = anchorReveals([q.options[q.correct]], spoken, D, { start: 1.2, last: Math.max(1.2, D - 2.2) })[0]
    q.options.forEach((_, i) => {
      const os = sizeFor(q.options[i], 0.5, 34, 58, 720)
      const optIn = 0.3 + i * 0.18 // options fade in quickly at the top of the scene
      const isCorrect = i === q.correct
      const delay = isCorrect ? answerAnchor : optIn
      body.push(
        `      <div class="opt rev" style="${del(optIn)}${isCorrect ? `;border-color:${p.green}` : ''}">${optionRow(q, i, delay, isCorrect, p, os)}</div>`
      )
    })
    if (q.explain) {
      const exSize = sizeFor(q.explain, 0.5, 34, 56, 940)
      const exAt = Math.min(D - 0.6, answerAnchor + 1.2)
      body.push(`      <div class="expl rev" style="font-size:${exSize}px;${del(exAt)}">${esc(q.explain)}</div>`)
    }
  } else {
    // Why the others are wrong — one row at a time, on a clean screen.
    body.push(`      <div class="q rev" style="font-size:64px;${del(0.25)}">Why the others miss</div>`)
    const wrongIdx = q.options.map((_, i) => i).filter((i) => i !== q.correct && (q.wrong[i] ?? '').trim())
    const anchorTexts = wrongIdx.map((i) => `${q.options[i]} ${q.wrong[i]}`)
    const reveals = anchorReveals(anchorTexts, spoken, D, { start: 0.7, last: Math.max(0.7, D - 0.6), spreadEnd: D * 0.82 })
    wrongIdx.forEach((i, k) => {
      const letter = optionLetter(i)
      const oSize = sizeFor(q.options[i], 0.5, 30, 50, 760)
      const rSize = sizeFor(q.wrong[i], 0.42, 28, 44, 860)
      body.push(
        `      <div class="wrow rev" style="${del(reveals[k])}">` +
          `<div class="wq" style="font-size:${oSize}px"><span class="wmk">${CROSS_SVG(p.coral)}</span><span>${letter}) ${esc(q.options[i])}</span></div>` +
          `<div class="wreason" style="font-size:${rSize}px">${esc(q.wrong[i])}</div>` +
          `</div>`
      )
    })
  }

  return frame(body.join('\n'), p, main, link, D, '')
}
