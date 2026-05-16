import fs from 'node:fs'
import type { VoiceProfile } from '@shared/types'

interface TtsConfig {
  baseUrl: string
  apiKey: string
}

/**
 * Node's global fetch wraps the real network error in err.cause. The visible
 * message ("fetch failed") tells you almost nothing — the cause has the real
 * code (ECONNREFUSED / ENOTFOUND / ETIMEDOUT / EAI_AGAIN / CERT_*). Unwrap it.
 */
function unwrapFetchError(err: unknown, url: string): Error {
  const e = err as any
  const cause = e?.cause
  const parts: string[] = []
  if (e?.name) parts.push(e.name)
  if (e?.message && e.message !== 'fetch failed') parts.push(e.message)
  if (cause) {
    if (cause.code) parts.push(`code=${cause.code}`)
    if (cause.errno) parts.push(`errno=${cause.errno}`)
    if (cause.syscall) parts.push(`syscall=${cause.syscall}`)
    if (cause.hostname) parts.push(`host=${cause.hostname}`)
    if (cause.address) parts.push(`address=${cause.address}`)
    if (cause.port) parts.push(`port=${cause.port}`)
    if (cause.message) parts.push(cause.message)
  }
  const detail = parts.length ? parts.join(' | ') : String(err)
  const friendly = friendlyHint(cause?.code, url)
  return new Error(`Network error calling ${url}: ${detail}${friendly ? ` — ${friendly}` : ''}`)
}

function friendlyHint(code: string | undefined, url: string): string {
  switch (code) {
    case 'ECONNREFUSED':
      return `nothing is listening at ${url}. Is the TTS server running?`
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `cannot resolve the hostname. If you're using a Cloudflare Tunnel URL, it may have rotated — restart the tunnel and update Settings → Base URL.`
    case 'ETIMEDOUT':
      return `the server didn't respond in time. Check that the TTS server is up and reachable from this PC.`
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return `TLS certificate problem — usually a stale tunnel URL.`
    case 'EPROTO':
      return `TLS handshake failed — try http:// instead of https:// if hitting localhost.`
    default:
      return ''
  }
}

export async function ttsHealth(cfg: TtsConfig): Promise<{ ok: boolean; detail?: string }> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/api/health`
  try {
    const res = await fetch(url, { method: 'GET' })
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} from ${url}` }
    const json = (await res.json()) as { status?: string }
    return { ok: json.status === 'ok', detail: JSON.stringify(json) }
  } catch (err: any) {
    return { ok: false, detail: unwrapFetchError(err, url).message }
  }
}

export async function listVoices(cfg: TtsConfig): Promise<unknown> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/api/voices`
  try {
    const res = await fetch(url, {
      headers: { 'X-API-Key': cfg.apiKey }
    })
    if (!res.ok) throw new Error(`listVoices failed: ${res.status} ${await safeReadText(res)}`)
    return res.json()
  } catch (err: any) {
    if (err?.message?.startsWith('listVoices failed:')) throw err
    throw unwrapFetchError(err, url)
  }
}

export interface GenerateArgs {
  text: string
  profile: VoiceProfile
  speedOverride?: number
  outPath: string
}

export async function generateAudio(cfg: TtsConfig, args: GenerateArgs): Promise<void> {
  if (!cfg.baseUrl) {
    throw new Error('TTS base URL is empty. Open Settings and fill it in.')
  }
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/api/generate`
  const form = new FormData()
  form.set('voice_id', args.profile.voice_id)
  form.set('text', args.text)
  form.set('speed', String(args.speedOverride ?? args.profile.default_speed ?? 1.0))
  form.set('format', args.profile.default_format ?? 'mp3')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000) // 10 min
  try {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'X-API-Key': cfg.apiKey },
        body: form,
        signal: controller.signal
      })
    } catch (err: any) {
      throw unwrapFetchError(err, url)
    }
    if (!res.ok) {
      const detail = await safeReadText(res)
      throw new Error(`TTS server returned HTTP ${res.status} from ${url}: ${detail.slice(0, 500)}`)
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
