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
1. Output EXACTLY one complete HTML document beginning with <!DOCTYPE html>. No markdown fences, no commentary.
2. The <body> contains exactly one root: <div id="stage" data-composition-id="main" data-width="W" data-height="H" data-duration="D">…</div>
   where W, H, D are filled with the values the user requests.
3. All CSS must be inline in a <style> block. All JS must be inline in a <script> block. No external network references except CDN imports from cdnjs/jsdelivr/unpkg for animation libraries (gsap, anime.js, lottie-web). Prefer GSAP for complex timelines.
4. The total visible animation MUST end at exactly the requested duration (data-duration seconds). Pace your animation so the scene feels intentional for that length — no awkward freezes, no abrupt cuts.
5. Do NOT include <audio> or <video> tags. Audio is added separately by the host pipeline.
6. The stage must fully fill its declared dimensions. Use a solid background color (do not rely on transparency).
7. Use modern, polished motion design: smooth easing, layered reveals, subtle parallax/scale, balanced typography. Respect the requested style hints.
8. Use system-safe fonts or Google Fonts loaded via <link>. If a font is named in style.fonts, prefer it.
9. Avoid randomness — animations must be deterministic so the same input renders the same output.
10. Do NOT include speaker text on screen unless the explainer asks for it; the voiceover is a separate audio track.`

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

Scene explainer (what the visuals should show and feel like):
"""
${args.explainer}
"""

The voiceover that will be played over this scene (for tone/pacing reference only — do not display this text on screen unless the explainer explicitly asks):
"""
${args.voiceover}
"""

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
