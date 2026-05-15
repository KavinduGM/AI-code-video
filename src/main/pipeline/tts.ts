import fs from 'node:fs'
import type { VoiceProfile } from '@shared/types'

interface TtsConfig {
  baseUrl: string
  apiKey: string
}

export async function ttsHealth(cfg: TtsConfig): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/api/health`, {
      method: 'GET'
    })
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    const json = (await res.json()) as { status?: string }
    return { ok: json.status === 'ok', detail: JSON.stringify(json) }
  } catch (err: any) {
    return { ok: false, detail: err.message }
  }
}

export async function listVoices(cfg: TtsConfig): Promise<unknown> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/api/voices`, {
    headers: { 'X-API-Key': cfg.apiKey }
  })
  if (!res.ok) throw new Error(`listVoices failed: ${res.status} ${await res.text()}`)
  return res.json()
}

export interface GenerateArgs {
  text: string
  profile: VoiceProfile
  speedOverride?: number
  outPath: string
}

export async function generateAudio(cfg: TtsConfig, args: GenerateArgs): Promise<void> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/api/generate`
  const form = new FormData()
  form.set('voice_id', args.profile.voice_id)
  form.set('text', args.text)
  form.set('speed', String(args.speedOverride ?? args.profile.default_speed ?? 1.0))
  form.set('format', args.profile.default_format ?? 'mp3')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000) // 10 min
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-API-Key': cfg.apiKey },
      body: form,
      signal: controller.signal
    })
    if (!res.ok) {
      const detail = await safeReadText(res)
      throw new Error(`generateAudio failed: ${res.status} ${detail}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.promises.writeFile(args.outPath, buf)
  } finally {
    clearTimeout(timeout)
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}
