import Anthropic from '@anthropic-ai/sdk'
import type { AspectRatio, ScriptSpec } from '@shared/types'
import { dimensionsForRatio } from './parser'

export interface SceneRenderArgs {
  apiKey: string
  model: string
  ratio: AspectRatio
  durationSeconds: number
  sceneIndex: number
  totalScenes: number
  explainer: string
  voiceover: string
  style?: ScriptSpec['style']
}

const SYSTEM_PROMPT = `You are an expert motion-graphics engineer who writes self-contained HTML compositions for the HeyGen Hyperframes renderer.

Hyperframes renders an "index.html" with a #stage element to MP4 frame-by-frame.
The stage MUST declare data-width and data-height matching the target resolution.
Elements inside the stage can use data-start and data-duration (in seconds) to schedule timed entry,
or you may drive everything with GSAP / CSS keyframes / anime.js — whichever you prefer.

Hard requirements you MUST follow:

1. Output EXACTLY one complete HTML document beginning with <!DOCTYPE html>. No markdown fences, no commentary, no preamble.

2. The <body> contains exactly one root:
   <div id="stage" data-composition-id="main" data-width="W" data-height="H" data-duration="D">…</div>
   where W, H, D are filled with the exact values the user requests.

3. All CSS must be inline in a <style> block. All JS must be inline in a <script> block.
   External references are allowed ONLY for CDN imports of animation libraries (gsap, anime.js, lottie-web)
   and Google Fonts. Prefer GSAP timelines for complex sequencing.

4. THE TIMELINE IS A SINGLE LINEAR PLAYTHROUGH FROM 0 TO D SECONDS. ABSOLUTELY NO LOOPING.
   - Never use GSAP \`repeat: -1\`, \`repeat: N\` > 0, or \`yoyo: true\` with repeats.
   - Never use CSS \`animation-iteration-count: infinite\` or any value > 1.
   - Never use \`setInterval\` for animation.
   - Every animation runs exactly once, ends in its final visual state, and stays in that state.
   - Subtle ambient ornaments (e.g. a slowly drifting gradient background) MAY use long single-pass
     transitions, but must NOT loop. If you want continuous motion, build it as one long tween from
     0 → D seconds with no repeat.

5. THE EXPLAINER OFTEN CONTAINS MULTIPLE SECTIONS OR BEATS. Map them onto a sequential timeline:
   - Identify each distinct beat in the explainer (e.g. "OPENING", "SECTION 1", "SECTION 2", "CLOSING").
   - Divide the duration D between them in proportion to how much content each beat carries.
   - Each beat occupies a CONTIGUOUS, NON-OVERLAPPING time block. Beat N+1 starts only after Beat N
     has fully revealed (allow a brief 0.3–0.6s crossfade between beats if it improves polish).
   - Within a beat, elements can stagger in, but the beat's last element must finish before the next
     beat begins. Earlier beats' elements either remain on stage or are explicitly transitioned out
     (fade/slide/clear) before the next beat's content appears.

6. The total visible animation MUST end exactly at D seconds. No awkward freezes, no abrupt cuts,
   no dead space at the end. If a beat finishes early, hold its final state until the next beat starts.

7. Do NOT include <audio> or <video> tags. Audio is added separately by the host pipeline.

8. The stage must fully fill its declared dimensions. Use a solid background color (do not rely on transparency).

9. Use modern, polished motion design: smooth easing, layered reveals, balanced typography.
   Respect the requested style hints (description, colors, fonts) faithfully — if "hand-drawn"
   is requested, use rough strokes, jitter, write-on SVG paths. If "minimal" is requested, restrain motion.

10. Use system-safe fonts or Google Fonts loaded via <link>. If a font is named in the style hints,
    prefer it and load it via Google Fonts if it exists there.

11. Animations must be DETERMINISTIC — no Math.random() driving visible motion. The same input must
    render the same output every time.

12. Do NOT put the voiceover text on screen unless the explainer explicitly asks for on-screen text.
    The voiceover is a separate audio track played alongside.`

function buildUserPrompt(args: SceneRenderArgs): string {
  const dims = dimensionsForRatio(args.ratio)
  const style = args.style
    ? `\nStyle hints:\n- description: ${args.style.description ?? '(none)'}\n- colors: ${(args.style.colors ?? []).join(', ') || '(none)'}\n- fonts: ${(args.style.fonts ?? []).join(', ') || '(none)'}`
    : ''
  return `Build a single Hyperframes composition for scene ${args.sceneIndex + 1} of ${args.totalScenes}.

Aspect ratio: ${args.ratio}
Resolution: ${dims.width}x${dims.height}
Total duration (seconds): ${args.durationSeconds.toFixed(3)}
${style}

Scene explainer (what the visuals should show and feel like). It MAY contain multiple SECTIONS / beats.
If it does, your timeline must traverse them sequentially in order, dividing the ${args.durationSeconds.toFixed(2)}-second duration between them, and NEVER looping:
"""
${args.explainer}
"""

The voiceover that will be played over this scene (for tone/pacing reference only — do not display this text on screen unless the explainer explicitly asks):
"""
${args.voiceover}
"""

Before you write any animation code, plan internally:
1. List the distinct beats/SECTIONS in the explainer in order.
2. Assign each beat a start time and a length so they tile [0, ${args.durationSeconds.toFixed(2)}] with no gaps and no overlap (except optional 0.3–0.6s crossfades).
3. Then write the HTML so every animation runs exactly once and finishes in its terminal state. No infinite loops, no repeat, no animation-iteration-count > 1.

Return ONLY the full HTML document.`
}

export async function generateSceneHtml(args: SceneRenderArgs): Promise<string> {
  if (!args.apiKey) throw new Error('Anthropic API key is not set in Settings.')
  const client = new Anthropic({ apiKey: args.apiKey })

  const resp = await client.messages.create({
    model: args.model || 'claude-opus-4-7',
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(args) }]
  })

  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('\n')
    .trim()

  return extractHtml(text)
}

function extractHtml(raw: string): string {
  let s = raw.trim()
  // Strip a leading code fence if present.
  if (s.startsWith('```')) {
    const firstNl = s.indexOf('\n')
    if (firstNl >= 0) s = s.slice(firstNl + 1)
    const fenceEnd = s.lastIndexOf('```')
    if (fenceEnd >= 0) s = s.slice(0, fenceEnd)
    s = s.trim()
  }
  const start = s.toLowerCase().indexOf('<!doctype html')
  if (start > 0) s = s.slice(start)
  if (!/<!doctype html/i.test(s) || !/<\/html>/i.test(s)) {
    throw new Error('Claude did not return a complete HTML document.')
  }
  return s
}
