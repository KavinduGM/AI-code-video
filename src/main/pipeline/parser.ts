import { parse } from 'yaml'
import type { ScriptSpec, AspectRatio, SceneSpec, TransitionType } from '@shared/types'
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

  let style: ScriptSpec['style'] | undefined
  if (r.style !== undefined) {
    if (typeof r.style !== 'object' || r.style === null) {
      throw new ScriptValidationError('style must be a mapping.', 'style')
    }
    const s = r.style as Record<string, unknown>
    style = {
      description: s.description !== undefined ? String(s.description) : undefined,
      colors:
        s.colors !== undefined
          ? requireStringArray(s.colors, 'style.colors')
          : undefined,
      fonts:
        s.fonts !== undefined ? requireStringArray(s.fonts, 'style.fonts') : undefined
    }
  }

  if (!Array.isArray(r.scenes) || r.scenes.length === 0) {
    throw new ScriptValidationError('scenes must be a non-empty array.', 'scenes')
  }

  const scenes: SceneSpec[] = (r.scenes as unknown[]).map((s, i) => parseScene(s, i))

  return {
    video_name,
    ratio,
    output_folder,
    voice_profile,
    voice_speed,
    style,
    scenes
  }
}

function parseScene(raw: unknown, idx: number): SceneSpec {
  const path = `scenes[${idx}]`
  if (!raw || typeof raw !== 'object') {
    throw new ScriptValidationError('Scene must be a mapping.', path)
  }
  const s = raw as Record<string, unknown>
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
  return {
    explainer,
    voiceover,
    transition_out: { type: ttype, duration: ttype === 'none' ? 0 : tdur }
  }
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

function requireStringArray(v: unknown, path: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new ScriptValidationError('Must be an array of strings.', path)
  }
  return v as string[]
}

export function dimensionsForRatio(ratio: AspectRatio) {
  return RATIO_DIMENSIONS[ratio]
}
