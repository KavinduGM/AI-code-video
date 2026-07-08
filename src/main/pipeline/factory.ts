// =====================================================================
// SCRIPT FACTORY — theory document → verified short-video scripts
// =====================================================================
// The user uploads an exam theory document (sections separated by ---)
// under a channel with the exam's display name (e.g. "WGU C310 OA").
// For each concept section, Claude writes a complete YAML script using
// the master guide prompt below (which encodes every rule the system
// has accumulated: 3-scene pattern, whole-line display quotes, filled
// stars, 2-scene intro/outro (the badge chip carries the exam name and
// scene1 is a pure hook that never repeats it), universal outro,
// music rotation, varied palettes). Every generated script then passes
// a strict DETERMINISTIC validator plus a Claude review before it is
// allowed anywhere near the render queue — an unverified script never
// becomes a video.
// =====================================================================

import Anthropic from '@anthropic-ai/sdk'
import { parseScript, ScriptValidationError } from './parser'
import { extractDisplayLines } from './claude'
import type { ScriptSpec } from '@shared/types'
import { optionLetter, type ParsedQuestion } from './docdetect'

// ---------------------------------------------------------------------
// Concept splitting
// ---------------------------------------------------------------------

/** Split a theory document into concept sections (--- separated). */
export function splitConcepts(text: string): string[] {
  return text
    .split(/\r?\n\s*---+\s*\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 200) // drop headers/stubs — a real concept has substance
}

// ---------------------------------------------------------------------
// Style rotation: palettes vary across the shorts of one exam (wraps via %)
// ---------------------------------------------------------------------

export const FACTORY_PALETTES: { bg: string; accent: string; emph: string; warn: string; body: string; bgName: string }[] = [
  { bg: '#141B27', accent: '#FFC94D', emph: '#63D9B8', warn: '#F2705B', body: '#F5F3EE', bgName: 'midnight blue' },
  { bg: '#1C1426', accent: '#FFC94A', emph: '#57C7E3', warn: '#FF8368', body: '#F5F3F0', bgName: 'dark plum' },
  { bg: '#0D2230', accent: '#F2B33D', emph: '#7BDCB5', warn: '#F97068', body: '#F2F1EF', bgName: 'deep teal-navy' },
  { bg: '#1D1A2F', accent: '#F7B32B', emph: '#7EE0D2', warn: '#FF8A70', body: '#F6F4EF', bgName: 'dark indigo' },
  { bg: '#14202E', accent: '#FFB84D', emph: '#6FE3C1', warn: '#FF7B6B', body: '#F4F2ED', bgName: 'deep navy' },
  { bg: '#151E14', accent: '#E8C63B', emph: '#7FD8A4', warn: '#F2705B', body: '#F4F3EC', bgName: 'deep forest' },
  { bg: '#241820', accent: '#F5B93F', emph: '#6BD5CE', warn: '#FF7E67', body: '#F6F2EE', bgName: 'dark mulberry' },
  { bg: '#10222B', accent: '#FFCB4F', emph: '#79DBC0', warn: '#F87A62', body: '#F3F2ED', bgName: 'deep petrol' },
  { bg: '#1B1B2E', accent: '#F6C23C', emph: '#68D2E8', warn: '#FF8570', body: '#F5F4EF', bgName: 'dark slate-violet' },
  { bg: '#201510', accent: '#F3B83E', emph: '#7ADFB2', warn: '#F97C6A', body: '#F6F3EE', bgName: 'deep espresso' }
]

// ---------------------------------------------------------------------
// Intro/outro hook styles (from the user's reference document — the exam
// name is swapped per exam; these are inspiration, never copied blindly)
// ---------------------------------------------------------------------

// The badge chip above intro scene1 already shows the exam name, so every
// scene1 hook below stands ALONE as a full natural line — never a stub left
// over after removing the exam name.
const HOOK_EXAMPLES = `
1) VO: "{EXAM}, one wrong answer can cost you. Here's what most students miss on day one."
   scene1: "Most students miss this on day one." scene2: "Don't be one of them."
   OUTRO VO: "Now you know what others don't. Watch the full video, link in description."
   outro scene1: "Edge gained." scene2: "Watch the full video, link in description."
2) VO: "{EXAM}, your OA is closer than you think. But only if you nail this concept first."
   scene1: "This one concept is worth easy marks." scene2: "Watch before your exam."
   OUTRO VO: "That's one concept locked in. Watch the full video, link in description."
   outro scene1: "Concept: locked." scene2: "Watch the full video, link in description."
3) VO: "{EXAM} prep doesn't have to be overwhelming. Let's cut through the noise, right here, right now."
   scene1: "One confusing topic, made simple." scene2: "Less confusion. More clarity. Let's go."
   OUTRO VO: "Less stress, more confidence. Watch the full video, link in description."
   outro scene1: "Clarity achieved." scene2: "Watch the full video, link in description."
4) VO: "{EXAM} students, stop guessing. This 60-second breakdown changes how you answer this question."
   scene1: "Stop guessing on this question." scene2: "60 seconds. Real results."
   OUTRO VO: "No more guessing on that one. Watch the full video, link in description."
   outro scene1: "Guesswork: eliminated." scene2: "Watch the full video, link in description."
5) VO: "{EXAM} is a test of application, not memorization. Here's how to think through this topic."
   scene1: "Don't memorize this. Understand it." scene2: "Here's the difference."
   OUTRO VO: "That's how you apply it, not just recall it. Watch the full video, link in description."
   outro scene1: "Understanding over memorizing." scene2: "Watch the full video, link in description."
`

// ---------------------------------------------------------------------
// The MASTER GUIDE PROMPT
// ---------------------------------------------------------------------

export interface GenerationTarget {
  examName: string // display name, e.g. "WGU C310 OA" — shown as the badge chip; never in scene1 text
  channel: string // channel name (script metadata only — the badge shows examName)
  videoName: string // exact video_name the script MUST use
  outputFolder: string
  voiceProfile: string
  backgroundMusic?: string // saved music profile name for this short
  templateSet?: number // 1..10 — shorts rotate through the template sets in order
  paletteIndex: number
  conceptText: string
}

export function buildScriptPrompt(t: GenerationTarget): string {
  const p = FACTORY_PALETTES[t.paletteIndex % FACTORY_PALETTES.length]
  return `You write YAML scripts for an automated shorts-video system. Output ONE complete YAML document and NOTHING else — no markdown fences, no commentary.

THE CONCEPT to teach (from the exam theory document):
<<<CONCEPT
${t.conceptText.slice(0, 5000)}
CONCEPT>>>

EXACT VALUES the script MUST use verbatim:
- video_name: ${t.videoName}
- exam_name: "${t.examName}"
- ratio: "9:16"
- output_folder: ${t.outputFolder}
- voice_profile: ${t.voiceProfile}
- voice_speed: 1.0
${t.backgroundMusic ? `- background_music: "${t.backgroundMusic}"` : ''}
${t.templateSet ? `- template_set: ${t.templateSet}` : ''}
- channel: "${t.channel}"
- colors (exactly these 5, in this order):
  - "${p.bg}"   # ${p.bgName} — background
  - "${p.accent}"   # accent — titles, key points, memory hooks
  - "${p.emph}"   # emphasis — box outlines, check marks
  - "${p.warn}"   # warning — traps, cross marks
  - "${p.body}"   # off-white — body text
- fonts: "Caveat", "Kalam", "Shadows Into Light"

DESCRIPTION field — copy this block exactly (only replace the background color name):
description: |
  Hand-drawn marker aesthetic for the scenes — text and small marks look
  drawn with a marker, slightly imperfect strokes. Headings write in
  letter by letter; body lines write in smoothly. Boxes are CLEAN
  outlines with their text inside; small check/cross/star marks draw in
  once and hold. Marks like stars must be FILLED shapes, never stroke
  outlines. Emphasis comes from color and a soft one-time pop on the key
  word. Content feels full — large text, comfortable gaps. Background
  stays a solid ${p.bgName} the entire time. 9:16 vertical — keep
  everything inside the safe area; the bottom is reserved for captions.

INTRO (2 scenes — the system renders scene1 then scene2):
- The system shows a highlighted badge chip with "${t.examName}" ABOVE scene1 automatically — so scene1 must NOT contain the exam name (it would double up).
- voiceover: 1–2 punchy sentences, 15–40 words, MUST include "${t.examName}".
- scene1: a punchy hook WITHOUT the exam name — a FULL natural line of 4-8 words (15-45 characters), never a leftover stub. "Most miss this." is TOO SHORT next to the badge; pad it into a complete thought like "Most miss this on day one."
- scene2: a short momentum line (max ~45 characters).
Style inspiration ({EXAM} appears only in voiceovers — the on-screen badge carries the exam name, so the scene1 hooks stand alone; write your OWN variant that fits this concept):
${HOOK_EXAMPLES}

OUTRO (2 scenes — UNIVERSAL, must NOT mention the exam name anywhere):
- voiceover: 10–35 words, confident payoff + "Watch the full video, link in description."
- scene1: short payoff line (max ~40 characters), no exam name.
- scene2: "Watch the full video, link in description."
- subscribe: true

SCENES — exactly 3, following the proven pattern:
Scene 1 — HOOK/TRAP (text only, no shapes): a heading + 3 short lines across TOP/UPPER/MIDDLE/LOWER bands.
Scene 2 — EXPLANATION (one box): heading, then a clean rectangular box (emphasis-color outline) revealing first with TWO short lines writing in inside it, then one accent line below.
Scene 3 — EXAM TIP (marks): heading "Exam Tip", then two emphasis-color check marks with labels, one warning-color cross mark with a label (the classic trap), and one accent FILLED star with the memory hook. Stars must be FILLED shapes, never outlines.

HARD RULES for every scene explainer:
- Solid ${p.bgName} (${p.bg}) background the whole time; state it.
- Structure as "Step 1 (TOP band): … Step 2 (UPPER band): …" etc. — one element per band, center-aligned.
- Every on-screen display line goes in double quotes ALONE ON ITS OWN LINE in the explainer (that is how the system builds and verifies them). Keep each display line ≤ 42 characters. 4–6 display lines per scene.
- Inline emphasis is allowed ("with the word \\"trigger\\" in ${p.emph} and a soft one-time pop").
- Each element reveals ONCE and holds; end with "Hold the full composition cleanly until the scene ends."
- transition_out: scene 1 → {type: fade, duration: 0.5}; scene 2 → {type: dissolve, duration: 0.5}; scene 3 → {type: none, duration: 0}.

VOICEOVERS: conversational exam-coach tone, drawn from the concept text (its trap, signal words, contrasts). Scene voiceovers 50–110 words each; total video ≈ 60–90 seconds. Never read display lines word-for-word — the text is the skeleton, the voice adds the story. Spell out numbers where natural.

EXACT YAML SHAPE — the parser is STRICT. Use ONLY these keys, nowhere else, no extras (no id, no name, no title, no notes — an unknown key REJECTS the whole script):

video_name: …
exam_name: "…"
ratio: "9:16"
output_folder: …
voice_profile: …
voice_speed: 1.0
background_music: "…"
template_set: …
channel: "…"
colors: [5 items]
fonts: [3 items]
description: |
  …
intro:
  voiceover: |
    …
  scene1: "…"
  scene2: "…"
outro:
  voiceover: |
    …
  scene1: "…"
  scene2: "…"
  subscribe: true        # REQUIRED — never omit
scenes:                  # each scene has EXACTLY these 3 keys:
  - explainer: |
      …
    voiceover: |
      …
    transition_out:
      type: fade
      duration: 0.5

Output the complete YAML now.`
}

// ---------------------------------------------------------------------
// QUESTION SHORTS — one exam question per short (from a question bank).
// The question DATA is parsed deterministically (docdetect); Claude only
// SHORTENS the on-screen text and writes the voiceovers + reframed intro,
// and MUST keep the correct-answer index exactly as given.
// ---------------------------------------------------------------------

export interface QuestionTarget {
  examName: string
  channel: string
  videoName: string
  outputFolder: string
  voiceProfile: string
  backgroundMusic?: string
  templateSet?: number
  paletteIndex: number
  question: ParsedQuestion
}

export function buildQuestionPrompt(t: QuestionTarget): string {
  const p = FACTORY_PALETTES[t.paletteIndex % FACTORY_PALETTES.length]
  const q = t.question
  const optLines = q.options.map((o, i) => `  ${optionLetter(i)}) ${o}`).join('\n')
  const whyLines = q.options
    .map((_, i) => (i === q.correctIndex ? '' : `  ${optionLetter(i)}: ${q.whyWrong[i] || '(no reason given)'}`))
    .filter(Boolean)
    .join('\n')
  const correctL = optionLetter(q.correctIndex)
  return `You write YAML scripts for an automated shorts-video system. This is a QUESTION short — ONE exam question, not a concept breakdown. Output ONE complete YAML document and NOTHING else — no markdown fences, no commentary.

THE EXAM QUESTION (keep the answer EXACT; SHORTEN every on-screen text so it fits a phone screen):
Question: ${q.question}
Options:
${optLines}
CORRECT ANSWER: ${correctL} (zero-based index ${q.correctIndex}) — this is FIXED, never change it.
Why correct: ${q.whyCorrect}
Why each wrong option is wrong:
${whyLines}

EXACT VALUES the script MUST use verbatim:
- video_name: ${t.videoName}
- exam_name: "${t.examName}"
- ratio: "9:16"
- output_folder: ${t.outputFolder}
- voice_profile: ${t.voiceProfile}
- voice_speed: 1.0
${t.backgroundMusic ? `- background_music: "${t.backgroundMusic}"` : ''}
${t.templateSet ? `- template_set: ${t.templateSet}` : ''}
- channel: "${t.channel}"
- colors (exactly these 5, in this order):
  - "${p.bg}"
  - "${p.accent}"
  - "${p.emph}"
  - "${p.warn}"
  - "${p.body}"
- fonts: "Poppins", "Poppins"
- description: |
    Clean quiz short on a solid ${p.bgName} background. One exam question with
    lettered options, a five-second countdown, then the answer highlighted and
    explained. Large readable text, kept inside the 9:16 safe area.

THE question: BLOCK (this drives the on-screen quiz — the answer index is FIXED):
- ask: the question, SHORTENED to ≤ 70 characters but still clear.
- options: the ${q.options.length} options, each SHORTENED to ≤ 30 characters, in the SAME ORDER as above.
- correct: ${q.correctIndex}   # MUST be exactly ${q.correctIndex} (option ${correctL})
- explain: why the correct answer is right, SHORTENED to ≤ 60 characters.
- wrong: a list aligned 1:1 with options — the reason each option is wrong, ≤ 70 characters each; put "" (empty) at index ${q.correctIndex} (the correct one).

INTRO (2 scenes — reframed for a QUESTION, not a concept):
- The system shows a badge chip with "${t.examName}" above scene1, so scene1 must NOT contain the exam name.
- voiceover: 1–2 sentences, 15–40 words, MUST include "${t.examName}", framing it as a quick question to test yourself.
- scene1: a hook that invites a guess, 4–8 words, e.g. "Can you get this one right?" (max 45 chars, no exam name).
- scene2: a short momentum line, e.g. "Test yourself in 60 seconds." (max 45 chars).

THREE SCENE VOICEOVERS (the visuals are rendered deterministically by the system — the explainer is just a one-line note):
- Scene 1 voiceover: pose the question naturally, then read the options ("Is it A, …; B, …;" etc.), then say "Guess the answer" — and END by counting down slowly: "Okay — five… four… three… two… one." (The on-screen countdown syncs to this.) 45–90 words.
- Scene 2 voiceover: reveal that the answer is ${correctL}, and explain WHY in plain exam-coach language (from "Why correct" above). 30–70 words.
- Scene 3 voiceover: go through the other options and say why each is wrong, briefly, one by one. 30–90 words.
- Each scene explainer: a single short note line (it is not rendered), e.g. "Quiz — question, options, and countdown."
- transition_out: scene 1 → {type: fade, duration: 0.5}; scene 2 → {type: dissolve, duration: 0.5}; scene 3 → {type: none, duration: 0}.

OUTRO (2 scenes — UNIVERSAL, must NOT mention the exam name):
- voiceover: 10–35 words, confident payoff + "Watch the full video, link in description."
- scene1: short payoff line (max ~40 characters), no exam name.
- scene2: "Watch the full video, link in description."
- subscribe: true

EXACT YAML SHAPE — the parser is STRICT; use ONLY these keys:

video_name: …
exam_name: "…"
ratio: "9:16"
output_folder: …
voice_profile: …
voice_speed: 1.0
${t.backgroundMusic ? 'background_music: "…"\n' : ''}${t.templateSet ? 'template_set: …\n' : ''}channel: "…"
colors: [5 items]
fonts: ["Poppins", "Poppins"]
description: |
  …
question:
  ask: "…"
  options:
    - "…"
  correct: ${q.correctIndex}
  explain: "…"
  wrong:
    - "…"
intro:
  voiceover: |
    …
  scene1: "…"
  scene2: "…"
outro:
  voiceover: |
    …
  scene1: "…"
  scene2: "…"
  subscribe: true
scenes:
  - explainer: |
      Quiz — question, options, and countdown.
    voiceover: |
      …
    transition_out:
      type: fade
      duration: 0.5
  - explainer: |
      Quiz — reveal the correct answer and explain it.
    voiceover: |
      …
    transition_out:
      type: dissolve
      duration: 0.5
  - explainer: |
      Quiz — why the other options are wrong.
    voiceover: |
      …
    transition_out:
      type: none
      duration: 0

Output the complete YAML now.`
}

export interface QuestionExpectations extends FactoryExpectations {
  correctIndex: number
  optionCount: number
}

export function validateQuestionScript(yaml: string, expect: QuestionExpectations): { spec: ScriptSpec | null; errors: string[] } {
  let spec: ScriptSpec
  try {
    spec = parseScript(yaml)
  } catch (err: any) {
    const msg = err instanceof ScriptValidationError ? err.message : String(err?.message ?? err)
    return { spec: null, errors: [`YAML does not parse/validate: ${msg}`] }
  }
  const errors: string[] = []
  const exam = expect.examName.toLowerCase()

  if (spec.video_name !== expect.videoName) errors.push(`video_name must be exactly "${expect.videoName}" (got "${spec.video_name}")`)
  if (spec.ratio !== '9:16') errors.push('ratio must be "9:16"')
  if ((spec.channel ?? '') !== expect.channel) errors.push(`channel must be "${expect.channel}"`)
  if ((spec.exam_name ?? '') !== expect.examName) errors.push(`exam_name must be exactly "${expect.examName}"`)
  if (spec.voice_profile !== expect.voiceProfile) errors.push(`voice_profile must be "${expect.voiceProfile}"`)
  if (expect.backgroundMusic && spec.background_music !== expect.backgroundMusic) errors.push(`background_music must be "${expect.backgroundMusic}"`)
  if (expect.templateSet && spec.template_set !== expect.templateSet) errors.push(`template_set must be ${expect.templateSet}`)

  // The question block — the answer must stay exactly what the source said.
  if (!spec.question) errors.push('question block is missing (this is a question short)')
  else {
    const q = spec.question
    if (q.options.length !== expect.optionCount) errors.push(`question.options must have ${expect.optionCount} entries (got ${q.options.length})`)
    if (q.correct !== expect.correctIndex) errors.push(`question.correct must be ${expect.correctIndex} — the source answer; do NOT change it (got ${q.correct})`)
    if (q.ask.length > 90) errors.push(`question.ask too long (max 90 chars): "${q.ask.slice(0, 60)}…"`)
    q.options.forEach((o, i) => {
      if (o.length > 40) errors.push(`question.options[${i}] too long (max 40 chars): "${o.slice(0, 44)}…"`)
    })
    if (q.explain.length > 90) errors.push('question.explain too long (max 90 chars)')
    q.wrong.forEach((w, i) => {
      if (i !== q.correct && w && w.length > 100) errors.push(`question.wrong[${i}] too long (max 100 chars)`)
    })
  }

  // Intro — reframed hook, exam name only in the voiceover (badge shows it).
  if (!spec.intro) errors.push('intro section is missing')
  else {
    if (!spec.intro.scene1 || !spec.intro.scene2) errors.push('intro needs BOTH scene1 and scene2')
    const escExam = expect.examName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const preB = /^\w/.test(expect.examName) ? '\\b' : ''
    const postB = /\w$/.test(expect.examName) ? '\\b' : ''
    const examRe = new RegExp(`${preB}${escExam}${postB}`, 'i')
    for (const [part, txt] of [['scene1', spec.intro.scene1], ['scene2', spec.intro.scene2]] as const)
      if (txt && examRe.test(txt)) errors.push(`intro ${part} must NOT contain the exam name (the badge already shows it)`)
    if (spec.intro.scene1 && spec.intro.scene1.length > 60) errors.push('intro scene1 too long (max 60 chars)')
    if (!spec.intro.voiceover.toLowerCase().includes(exam)) errors.push('intro voiceover must mention the exam name')
  }

  // Outro — universal.
  if (!spec.outro) errors.push('outro section is missing')
  else {
    if (!spec.outro.scene1 || !spec.outro.scene2) errors.push('outro needs BOTH scene1 and scene2')
    if (!spec.outro.subscribe) errors.push('outro must set subscribe: true')
    const outroText = `${spec.outro.voiceover} ${spec.outro.scene1 ?? ''} ${spec.outro.scene2 ?? ''}`.toLowerCase()
    if (outroText.includes(exam)) errors.push('outro is UNIVERSAL — it must not mention the exam name')
  }

  // Exactly 3 scenes, each with a voiceover (the visuals are code-rendered).
  if (spec.scenes.length !== 3) errors.push(`exactly 3 scenes required (got ${spec.scenes.length})`)
  spec.scenes.forEach((sc, i) => {
    const w = words(sc.voiceover)
    if (w < 15 || w > 140) errors.push(`scene ${i + 1}: voiceover should be 15–140 words (got ${w})`)
  })
  // Scene 1's voiceover must actually count down for the on-screen countdown to sync.
  if (spec.scenes[0] && !/\b(one|1)\b/.test(spec.scenes[0].voiceover) && !/count/i.test(spec.scenes[0].voiceover))
    errors.push('scene 1 voiceover must end with a spoken countdown (…five, four, three, two, one) so the on-screen countdown syncs')

  const colors = spec.style?.colors ?? []
  if (colors.length !== 5 || !colors.every((c) => /^#[0-9a-fA-F]{6}$/.test(c))) errors.push('colors must be exactly 5 hex values')
  if (!spec.style?.fonts?.length) errors.push('fonts list is missing')

  return { spec, errors }
}

// ---------------------------------------------------------------------
// STORYBOARD → CONCEPTS. A "VisualCues" teaching storyboard has the real
// teaching content in its VOICEOVER lines. Claude distils it into focused
// `---`-separated concept sections that then flow through the normal
// concept → script pipeline.
// ---------------------------------------------------------------------

export async function normalizeStoryboardToConcepts(
  args: { apiKey: string; model: string; storyboard: string; examName: string; maxConcepts: number }
): Promise<string> {
  const client = new Anthropic({ apiKey: args.apiKey })
  const prompt = `This is the storyboard for one long teaching video for the ${args.examName} exam. Each "Point" has a VOICEOVER line (the actual teaching) plus drawing cues (ignore those).

Distil the teaching content into up to ${args.maxConcepts} SELF-CONTAINED exam concepts — each becomes its own short video. Rules:
- Draw the substance ONLY from the VOICEOVER lines. Ignore drawing/tablet cues, slide headers, and any "practice question bank"/CTA/review points.
- Group related points into ONE concept where they teach a single idea; pick the highest-value, non-overlapping exam topics.
- Each concept: a short "Topic: …" title line, then 400–900 characters of clean prose covering the definition, the exam trap/common confusion, and the memory hook or example the lecturer used.
- Separate concepts with a line containing ONLY --- (three hyphens), a blank line before and after.
- Output ONLY the concept sections (no preamble, no commentary, no fences).

STORYBOARD:
<<<
${args.storyboard.slice(0, 60000)}
>>>

Output the ${args.maxConcepts} concept sections now.`
  const stream = client.messages.stream({ model: args.model || 'claude-opus-4-8', max_tokens: 8000, messages: [{ role: 'user', content: prompt }] })
  const resp = await stream.finalMessage()
  let text = resp.content.filter((b) => b.type === 'text').map((b) => (b as Anthropic.TextBlock).text).join('\n').trim()
  text = text.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
  return text
}

// ---------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------

export async function generateScript(
  args: { apiKey: string; model: string; prompt: string; feedback?: string; previousYaml?: string },
  onStage?: (s: string) => void
): Promise<string> {
  const client = new Anthropic({ apiKey: args.apiKey })
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: args.prompt }]
  if (args.feedback && args.previousYaml) {
    // The model must SEE its previous attempt — otherwise it regenerates from
    // scratch and repeats the same structural habits the errors point at.
    messages.push({ role: 'assistant', content: args.previousYaml })
    messages.push({
      role: 'user',
      content: `That script failed verification with these EXACT problems — fix every one (change nothing else) and output the corrected COMPLETE YAML only:\n${args.feedback}`
    })
  }
  onStage?.('generating')
  const stream = client.messages.stream({
    model: args.model || 'claude-opus-4-8',
    max_tokens: 8000,
    messages
  })
  const resp = await stream.finalMessage()
  let text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('\n')
    .trim()
  // Strip accidental fences.
  text = text.replace(/^```(?:yaml|yml)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
  return text
}

// ---------------------------------------------------------------------
// DETERMINISTIC VALIDATOR — the format gate. A script that fails here is
// regenerated with the exact error list; it is never queued.
// ---------------------------------------------------------------------

export interface FactoryExpectations {
  videoName: string
  channel: string
  examName: string
  voiceProfile: string
  backgroundMusic?: string
  templateSet?: number
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

export function validateGeneratedScript(yaml: string, expect: FactoryExpectations): { spec: ScriptSpec | null; errors: string[] } {
  let spec: ScriptSpec
  try {
    spec = parseScript(yaml)
  } catch (err: any) {
    const msg = err instanceof ScriptValidationError ? err.message : String(err?.message ?? err)
    return { spec: null, errors: [`YAML does not parse/validate: ${msg}`] }
  }
  const errors: string[] = []
  const exam = expect.examName.toLowerCase()

  if (spec.video_name !== expect.videoName) errors.push(`video_name must be exactly "${expect.videoName}" (got "${spec.video_name}")`)
  if (spec.ratio !== '9:16') errors.push('ratio must be "9:16"')
  if ((spec.channel ?? '') !== expect.channel) errors.push(`channel must be "${expect.channel}"`)
  if ((spec.exam_name ?? '') !== expect.examName)
    errors.push(`exam_name must be exactly "${expect.examName}" — it becomes the highlighted badge on the video`)
  if (spec.voice_profile !== expect.voiceProfile) errors.push(`voice_profile must be "${expect.voiceProfile}"`)
  if (expect.backgroundMusic && spec.background_music !== expect.backgroundMusic)
    errors.push(`background_music must be "${expect.backgroundMusic}"`)
  if (expect.templateSet && spec.template_set !== expect.templateSet)
    errors.push(`template_set must be ${expect.templateSet}`)

  // Intro: pure-hook scene texts — the badge chip carries the exam name.
  if (!spec.intro) errors.push('intro section is missing')
  else {
    if (!spec.intro.scene1 || !spec.intro.scene2) errors.push('intro needs BOTH scene1 and scene2')
    // Word-boundary match so short exam names (e.g. "GED") don't false-match
    // inside ordinary words ("dodged") — but add a boundary ONLY where the exam
    // name actually begins/ends with a word char, so names ending in a symbol
    // ("Security+", "NCLEX (RN)") still match (a trailing \\b can never match
    // after "+" or ")").
    const escExam = expect.examName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const preB = /^\w/.test(expect.examName) ? '\\b' : ''
    const postB = /\w$/.test(expect.examName) ? '\\b' : ''
    const examRe = new RegExp(`${preB}${escExam}${postB}`, 'i')
    for (const [part, txt] of [['scene1', spec.intro.scene1], ['scene2', spec.intro.scene2]] as const)
      if (txt && examRe.test(txt))
        errors.push(`intro ${part} must NOT contain the exam name — the badge chip above scene1 already shows it; use a pure hook line`)
    if (spec.intro.scene1 && spec.intro.scene1.length > 60) errors.push('intro scene1 too long (max 60 chars)')
    if (spec.intro.scene1) {
      const hookWords = spec.intro.scene1.trim().split(/\s+/).length
      if (hookWords < 4 || spec.intro.scene1.trim().length < 15)
        errors.push(
          'intro scene1 hook too short — the badge already shows the exam name, so the hook must be a full natural line of 4-8 words, e.g. "Most miss this on day one."'
        )
    }
    if (spec.intro.scene2 && spec.intro.scene2.length > 60) errors.push('intro scene2 too long (max 60 chars)')
    if (!spec.intro.voiceover.toLowerCase().includes(exam)) errors.push('intro voiceover must mention the exam name')
    const w = words(spec.intro.voiceover)
    if (w < 10 || w > 55) errors.push(`intro voiceover should be 10–55 words (got ${w})`)
  }

  // Outro: universal — subscribe on, NO exam name anywhere.
  if (!spec.outro) errors.push('outro section is missing')
  else {
    if (!spec.outro.scene1 || !spec.outro.scene2) errors.push('outro needs BOTH scene1 and scene2')
    if (!spec.outro.subscribe) errors.push('outro must set subscribe: true')
    const outroText = `${spec.outro.voiceover} ${spec.outro.scene1 ?? ''} ${spec.outro.scene2 ?? ''}`.toLowerCase()
    if (outroText.includes(exam)) errors.push('outro is UNIVERSAL — it must not mention the exam name')
    if (spec.outro.scene1 && spec.outro.scene1.length > 60) errors.push('outro scene1 too long (max 60 chars)')
    const w = words(spec.outro.voiceover)
    if (w < 6 || w > 50) errors.push(`outro voiceover should be 6–50 words (got ${w})`)
  }

  // Exactly 3 scenes, each with proper display lines and pacing.
  if (spec.scenes.length !== 3) errors.push(`exactly 3 scenes required (got ${spec.scenes.length})`)
  spec.scenes.forEach((sc, i) => {
    const lines = extractDisplayLines(sc.explainer)
    if (lines.length < 3) errors.push(`scene ${i + 1}: needs at least 3 whole-line quoted display lines (got ${lines.length})`)
    for (const l of lines) {
      if (l.length > 48) errors.push(`scene ${i + 1}: display line too long (max 48 chars): "${l.slice(0, 50)}…"`)
    }
    if (!/band/i.test(sc.explainer)) errors.push(`scene ${i + 1}: explainer must place elements in bands (TOP/UPPER/MIDDLE/LOWER)`)
    const w = words(sc.voiceover)
    if (w < 35 || w > 140) errors.push(`scene ${i + 1}: voiceover should be 35–140 words (got ${w})`)
  })
  if (spec.scenes[2] && !/star/i.test(spec.scenes[2].explainer))
    errors.push('scene 3 must include the FILLED star memory-hook mark')

  // Style block.
  const colors = spec.style?.colors ?? []
  if (colors.length !== 5 || !colors.every((c) => /^#[0-9a-fA-F]{6}$/.test(c)))
    errors.push('colors must be exactly 5 hex values')
  if (!spec.style?.fonts?.length) errors.push('fonts list is missing')

  return { spec, errors }
}

// ---------------------------------------------------------------------
// CLAUDE REVIEWER — semantic second gate (content quality + guide fit).
// ---------------------------------------------------------------------

export async function reviewScriptWithClaude(args: {
  apiKey: string
  model: string
  yaml: string
  examName: string
  conceptText: string
}): Promise<{ pass: boolean; issues: string[] }> {
  const client = new Anthropic({ apiKey: args.apiKey })
  const resp = await client.messages.create({
    model: args.model || 'claude-opus-4-8',
    max_tokens: 1200,
    messages: [
      {
        role: 'user',
        content: `You are the quality gate for an automated shorts factory. Review this YAML script strictly. Reply with ONLY JSON: {"pass": boolean, "issues": ["..."]}.

FAIL it if ANY of these hold:
- The teaching content contradicts or misrepresents the CONCEPT text.
- Scene voiceovers don't teach the concept's trap / signal words / contrast (generic filler).
- The intro scene1/scene2 on-screen text contains "${args.examName}" (a highlighted badge chip above scene1 ALREADY displays the exam name on the video, so on-screen text must never repeat it), or the intro voiceover never says "${args.examName}", or the outro mentions the exam name.
- Display lines (quoted lines in explainers) are redundant with each other, cut mid-thought, or would confuse a viewer.
- A scene explainer asks for looping/pulsing animation, an outlined (non-filled) star, circles as text containers, or content outside the safe area / in the caption zone.
- The voiceover reads the on-screen lines verbatim instead of adding the story.

CONCEPT:
<<<
${args.conceptText.slice(0, 3500)}
>>>

SCRIPT:
<<<
${args.yaml.slice(0, 9000)}
>>>`
      }
    ]
  })
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('')
  try {
    const first = text.indexOf('{')
    const last = text.lastIndexOf('}')
    const parsed = JSON.parse(text.slice(first, last + 1))
    return { pass: !!parsed.pass, issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [] }
  } catch {
    // Fail-closed on unparseable reviews: treat as pass=false with a note so
    // the regeneration path (not the queue) handles it.
    return { pass: false, issues: ['reviewer response was not valid JSON — regenerate the script'] }
  }
}

/** Build the deterministic video_name for concept #i of an exam. */
export function factoryVideoName(examName: string, index: number): string {
  const slug = examName.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `${slug}_${String(index + 1).padStart(2, '0')}`
}
