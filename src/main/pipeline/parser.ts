import { parse } from 'yaml'
import type { ScriptSpec, AspectRatio, SceneSpec, TransitionType, QuestionSpec, ChartSpec } from '@shared/types'
import { RATIO_DIMENSIONS } from '@shared/types'

const VALID_RATIOS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:5', '21:9']
const VALID_TRANSITIONS: TransitionType[] = [
  'none',
  'fade',
  'dissolve',
  'slide_left',
  'slide_right',
  'slide_up',
  'slide_down',
  'wipe_left',
  'wipe_right',
  'wipe_up',
  'wipe_down'
]

const ALLOWED_TOP_LEVEL = new Set([
  'video_name',
  'ratio',
  'output_folder',
  'voice_profile',
  'voice_speed',
  'background_music',
  'captions',
  'channel',
  'exam_name',
  'template_set',
  'style',
  // Style fields are also accepted at the top level for ergonomics.
  'description',
  'colors',
  'fonts',
  'intro',
  'outro',
  'scenes',
  'question'
])

const ALLOWED_SCENE_KEYS = new Set(['explainer', 'voiceover', 'transition_out', 'chart'])
const ALLOWED_CHART_KEYS = new Set(['type', 'title', 'data', 'headers', 'rows', 'steps'])
const VALID_CHART_TYPES = new Set(['bar', 'compare', 'flow', 'donut'])

export class ScriptValidationError extends Error {
  constructor(message: string, public path?: string) {
    super(path ? `${path}: ${message}` : message)
  }
}

export function parseScript(yaml: string): ScriptSpec {
  let raw: unknown
  try {
    raw = parse(yaml)
  } catch (err: any) {
    throw new ScriptValidationError(`Invalid YAML: ${err.message}`)
  }
  if (!raw || typeof raw !== 'object') {
    throw new ScriptValidationError('Script must be a YAML mapping at the top level.')
  }
  const r = raw as Record<string, unknown>

  // Reject unknown top-level keys so typos surface immediately.
  for (const k of Object.keys(r)) {
    if (!ALLOWED_TOP_LEVEL.has(k)) {
      throw new ScriptValidationError(
        `Unknown top-level key "${k}". Allowed keys: ${Array.from(ALLOWED_TOP_LEVEL).join(', ')}.`,
        k
      )
    }
  }

  const video_name = requireString(r, 'video_name')
  if (!/^[A-Za-z0-9_\- ]+$/.test(video_name)) {
    throw new ScriptValidationError(
      'video_name may only contain letters, numbers, spaces, hyphens, and underscores.',
      'video_name'
    )
  }

  const ratio = requireString(r, 'ratio') as AspectRatio
  if (!VALID_RATIOS.includes(ratio)) {
    throw new ScriptValidationError(
      `ratio must be one of ${VALID_RATIOS.join(', ')}.`,
      'ratio'
    )
  }

  const output_folder = requireString(r, 'output_folder')
  const voice_profile = requireString(r, 'voice_profile')

  const voice_speed =
    r.voice_speed !== undefined ? requireNumber(r, 'voice_speed', 0.5, 2.0) : undefined

  const background_music =
    r.background_music !== undefined ? requireString(r, 'background_music') : undefined

  // Captions are ON unless explicitly disabled with `captions: false`.
  const captions = r.captions === false || r.captions === 'false' ? false : undefined

  const channel = r.channel !== undefined ? requireString(r, 'channel') : undefined
  const exam_name = r.exam_name !== undefined ? requireString(r, 'exam_name') : undefined
  const template_set =
    r.template_set !== undefined ? requireNumber(r, 'template_set', 1, 50) : undefined

  const style = parseStyle(r)

  const intro = parseIntroOutro(r.intro, 'intro')
  const outro = parseIntroOutro(r.outro, 'outro')

  if (!Array.isArray(r.scenes) || r.scenes.length === 0) {
    throw new ScriptValidationError('scenes must be a non-empty array.', 'scenes')
  }

  const scenes: SceneSpec[] = (r.scenes as unknown[]).map((s, i) => parseScene(s, i))

  const question = parseQuestion(r.question)

  return {
    video_name,
    ratio,
    output_folder,
    voice_profile,
    voice_speed,
    background_music,
    captions,
    channel,
    exam_name,
    template_set,
    style,
    intro,
    outro,
    scenes,
    question
  }
}

const ALLOWED_QUESTION_KEYS = new Set(['ask', 'options', 'correct', 'explain', 'wrong'])

function parseQuestion(raw: unknown): QuestionSpec | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') {
    throw new ScriptValidationError('question must be a mapping.', 'question')
  }
  const o = raw as Record<string, unknown>
  for (const k of Object.keys(o)) {
    if (!ALLOWED_QUESTION_KEYS.has(k)) {
      throw new ScriptValidationError(
        `Unknown question key "${k}". Allowed: ${Array.from(ALLOWED_QUESTION_KEYS).join(', ')}.`,
        `question.${k}`
      )
    }
  }
  const ask = requireString(o, 'ask', 'question.ask')
  if (!Array.isArray(o.options) || o.options.length < 2 || o.options.length > 4) {
    throw new ScriptValidationError('question.options must be a list of 2–4 strings.', 'question.options')
  }
  const options = o.options.map((v, i) => {
    if (typeof v !== 'string' || v.trim() === '')
      throw new ScriptValidationError('each option must be a non-empty string.', `question.options[${i}]`)
    return v.trim()
  })
  const correct = Number(o.correct)
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
    throw new ScriptValidationError(
      `question.correct must be an integer 0..${options.length - 1} (0-based index of the correct option).`,
      'question.correct'
    )
  }
  const explain = requireString(o, 'explain', 'question.explain')
  let wrong: string[] = []
  if (o.wrong !== undefined) {
    if (!Array.isArray(o.wrong))
      throw new ScriptValidationError('question.wrong must be a list of strings.', 'question.wrong')
    wrong = o.wrong.map((v) => (typeof v === 'string' ? v.trim() : ''))
  }
  // Normalise `wrong` to align 1:1 with options (blank at the correct index).
  const wrongAligned = options.map((_, i) => (i === correct ? '' : wrong[i] ?? ''))
  return { ask, options, correct, explain, wrong: wrongAligned }
}

const ALLOWED_INTRO_OUTRO_KEYS = new Set(['voiceover', 'on_screen', 'subscribe', 'highlight', 'scene1', 'scene2'])

function parseIntroOutro(raw: unknown, path: string): ScriptSpec['intro'] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') {
    throw new ScriptValidationError(`${path} must be a mapping with voiceover and on_screen.`, path)
  }
  const o = raw as Record<string, unknown>
  for (const k of Object.keys(o)) {
    if (!ALLOWED_INTRO_OUTRO_KEYS.has(k)) {
      throw new ScriptValidationError(
        `Unknown ${path} key "${k}". Allowed: voiceover, on_screen, subscribe, highlight, scene1, scene2.`,
        `${path}.${k}`
      )
    }
  }
  const voiceover = requireString(o, 'voiceover', `${path}.voiceover`)
  const subscribe = o.subscribe === true || o.subscribe === 'true'
  let highlight: string[] | undefined
  if (o.highlight !== undefined) {
    const raw = Array.isArray(o.highlight) ? o.highlight : [o.highlight]
    highlight = raw.map((v) => String(v).trim()).filter((v) => v.length > 0)
    if (highlight.length === 0) highlight = undefined
  }

  // 2-scene story template: scene1 + scene2 must come together. When present,
  // on_screen becomes optional (derived, so fallbacks like the static card
  // still have the full text to work with).
  const hasS1 = o.scene1 !== undefined
  const hasS2 = o.scene2 !== undefined
  if (hasS1 !== hasS2) {
    throw new ScriptValidationError(
      `${path} must define BOTH scene1 and scene2 (or neither — then use on_screen).`,
      path
    )
  }
  let scene1: string | undefined
  let scene2: string | undefined
  let on_screen: string
  if (hasS1 && hasS2) {
    scene1 = requireString(o, 'scene1', `${path}.scene1`)
    scene2 = requireString(o, 'scene2', `${path}.scene2`)
    on_screen =
      o.on_screen !== undefined ? requireString(o, 'on_screen', `${path}.on_screen`) : `${scene1}\n${scene2}`
  } else {
    on_screen = requireString(o, 'on_screen', `${path}.on_screen`)
  }
  return { voiceover, on_screen, subscribe, highlight, scene1, scene2 }
}

/**
 * Accepts style either at the top level or nested under `style:`.
 * Each of description / colors / fonts can be a plain string OR a list of strings.
 * Top-level fields take precedence if both forms are provided.
 */
function parseStyle(r: Record<string, unknown>): ScriptSpec['style'] | undefined {
  let nested: Record<string, unknown> = {}
  if (r.style !== undefined) {
    if (typeof r.style === 'string') {
      // Whole style as a single descriptive paragraph.
      nested.description = r.style
    } else if (r.style && typeof r.style === 'object') {
      nested = r.style as Record<string, unknown>
    } else {
      throw new ScriptValidationError('style must be a mapping or string.', 'style')
    }
  }

  const description = pickString(r.description ?? nested.description, 'description')
  const colors = pickStringList(r.colors ?? nested.colors, 'colors')
  const fonts = pickStringList(r.fonts ?? nested.fonts, 'fonts')

  if (description === undefined && colors === undefined && fonts === undefined) {
    return undefined
  }
  return { description, colors, fonts }
}

function parseScene(raw: unknown, idx: number): SceneSpec {
  const path = `scenes[${idx}]`
  if (!raw || typeof raw !== 'object') {
    throw new ScriptValidationError('Scene must be a mapping.', path)
  }
  const s = raw as Record<string, unknown>
  for (const k of Object.keys(s)) {
    if (!ALLOWED_SCENE_KEYS.has(k)) {
      throw new ScriptValidationError(
        `Unknown scene key "${k}". Allowed: ${Array.from(ALLOWED_SCENE_KEYS).join(', ')}.`,
        `${path}.${k}`
      )
    }
  }
  const explainer = requireString(s, 'explainer', `${path}.explainer`)
  const voiceover = requireString(s, 'voiceover', `${path}.voiceover`)

  const transitionRaw = (s.transition_out ?? { type: 'none', duration: 0 }) as Record<
    string,
    unknown
  >
  const ttype = String(transitionRaw.type ?? 'none') as TransitionType
  if (!VALID_TRANSITIONS.includes(ttype)) {
    throw new ScriptValidationError(
      `transition_out.type must be one of ${VALID_TRANSITIONS.join(', ')}.`,
      `${path}.transition_out.type`
    )
  }
  const tdur = Number(transitionRaw.duration ?? 0)
  if (!Number.isFinite(tdur) || tdur < 0 || tdur > 5) {
    throw new ScriptValidationError(
      'transition_out.duration must be a number between 0 and 5 seconds.',
      `${path}.transition_out.duration`
    )
  }
  const chart = parseChart(s.chart, `${path}.chart`)
  return {
    explainer,
    voiceover,
    transition_out: { type: ttype, duration: ttype === 'none' ? 0 : tdur },
    ...(chart ? { chart } : {})
  }
}

/**
 * Parse + validate an optional scene chart block. Returns undefined when the
 * scene has no chart. Every shape is checked here so a malformed chart is a
 * clear validation error (and the factory can regenerate) rather than a broken
 * render. Data is structured — nothing is inferred from prose.
 */
function parseChart(raw: unknown, path: string): ChartSpec | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object') throw new ScriptValidationError('chart must be a mapping.', path)
  const c = raw as Record<string, unknown>
  for (const k of Object.keys(c)) {
    if (!ALLOWED_CHART_KEYS.has(k))
      throw new ScriptValidationError(`Unknown chart key "${k}". Allowed: ${Array.from(ALLOWED_CHART_KEYS).join(', ')}.`, `${path}.${k}`)
  }
  const type = String(c.type ?? '') as ChartSpec['type']
  if (!VALID_CHART_TYPES.has(type))
    throw new ScriptValidationError(`chart.type must be one of ${Array.from(VALID_CHART_TYPES).join(', ')}.`, `${path}.type`)
  const title = c.title !== undefined ? String(c.title).trim() : undefined

  if (type === 'bar' || type === 'donut') {
    if (!Array.isArray(c.data) || c.data.length < 2 || c.data.length > 6)
      throw new ScriptValidationError(`chart.data must be a list of 2–6 { label, value } items for a ${type} chart.`, `${path}.data`)
    const data = c.data.map((d, i) => {
      const o = (d ?? {}) as Record<string, unknown>
      const label = String(o.label ?? '').trim()
      const value = Number(o.value)
      if (!label) throw new ScriptValidationError('each chart.data item needs a non-empty label.', `${path}.data[${i}].label`)
      if (!Number.isFinite(value) || value < 0)
        throw new ScriptValidationError('each chart.data value must be a number ≥ 0.', `${path}.data[${i}].value`)
      return { label, value }
    })
    if (type === 'donut' && data.reduce((s, d) => s + d.value, 0) <= 0)
      throw new ScriptValidationError('chart.data values for a donut must sum to more than 0.', `${path}.data`)
    return { type, title, data }
  }

  if (type === 'compare') {
    if (!Array.isArray(c.headers) || c.headers.length !== 2 || !c.headers.every((h) => typeof h === 'string' && h.trim()))
      throw new ScriptValidationError('chart.headers must be exactly two non-empty strings for a compare chart.', `${path}.headers`)
    if (!Array.isArray(c.rows) || c.rows.length < 1 || c.rows.length > 6)
      throw new ScriptValidationError('chart.rows must be a list of 1–6 "left | right" strings for a compare chart.', `${path}.rows`)
    const rows = c.rows.map((r, i) => {
      const s = String(r ?? '').trim()
      if (!s.includes('|')) throw new ScriptValidationError('each compare row must be "left | right" (contain a "|").', `${path}.rows[${i}]`)
      return s
    })
    return { type, title, headers: [c.headers[0].trim(), c.headers[1].trim()], rows }
  }

  // flow
  if (!Array.isArray(c.steps) || c.steps.length < 2 || c.steps.length > 5)
    throw new ScriptValidationError('chart.steps must be a list of 2–5 non-empty strings for a flow chart.', `${path}.steps`)
  const steps = c.steps.map((s, i) => {
    const t = String(s ?? '').trim()
    if (!t) throw new ScriptValidationError('each flow step must be a non-empty string.', `${path}.steps[${i}]`)
    return t
  })
  return { type, title, steps }
}

function requireString(obj: Record<string, unknown>, key: string, path?: string): string {
  const v = obj[key]
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ScriptValidationError(`${key} is required and must be a non-empty string.`, path ?? key)
  }
  return v.trim()
}

function requireNumber(
  obj: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  path?: string
): number {
  const v = Number(obj[key])
  if (!Number.isFinite(v) || v < min || v > max) {
    throw new ScriptValidationError(
      `${key} must be a number between ${min} and ${max}.`,
      path ?? key
    )
  }
  return v
}

function pickString(v: unknown, path: string): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'string') return v.trim() || undefined
  if (Array.isArray(v)) {
    const joined = v.map(String).filter((s) => s.trim() !== '').join(' ')
    return joined || undefined
  }
  throw new ScriptValidationError('Must be a string.', path)
}

function pickStringList(v: unknown, path: string): string[] | undefined {
  if (v === undefined || v === null) return undefined
  if (Array.isArray(v)) {
    const arr = v.map((x) => String(x).trim()).filter((s) => s !== '')
    return arr.length > 0 ? arr : undefined
  }
  if (typeof v === 'string') {
    // Allow "red, blue, green" or a single descriptive sentence — treat as one entry.
    const trimmed = v.trim()
    if (!trimmed) return undefined
    // If it looks like a comma list (multiple commas and no full sentences), split it.
    if (trimmed.includes(',') && trimmed.split(',').every((p) => p.trim().length < 60)) {
      return trimmed.split(',').map((s) => s.trim()).filter((s) => s !== '')
    }
    return [trimmed]
  }
  throw new ScriptValidationError('Must be a string or array of strings.', path)
}

export function dimensionsForRatio(ratio: AspectRatio) {
  return RATIO_DIMENSIONS[ratio]
}
