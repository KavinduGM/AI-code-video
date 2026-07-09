// =====================================================================
// BACKUP & RESTORE  — one portable, password-encrypted file
// =====================================================================
// Gathers everything that would be painful to re-create on a new PC — the
// Anthropic/ElevenLabs API keys, voice profiles (with voice IDs), music
// profiles + their audio files, the global music/transition sounds, and the
// per-channel template backdrop packs — into a single file. The config blob
// (which holds the keys) is AES-256-GCM encrypted with the user's passphrase;
// binary assets ride along in the same container. Import reverses it, copying
// assets into userData and rewriting the machine-specific paths so music and
// templates resolve on the new machine.
// =====================================================================

import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings, VoiceProfile, MusicProfile } from '@shared/types'
import {
  getSettings,
  setSettings,
  listProfiles,
  listMusic,
  replaceProfiles,
  replaceMusicProfiles,
  getStoragePaths
} from './settings'
import { packContainer, unpackContainer, encryptBlob, decryptBlob, type BackupEntry } from './backupformat'

const CONFIG = 'config'
const MUSIC_PREFIX = 'asset:music/'
const GLOBAL_PREFIX = 'asset:global/'
const TPL_PREFIX = 'asset:tpl/'

interface ConfigBlob {
  settings: AppSettings
  voiceProfiles: VoiceProfile[]
  musicProfiles: MusicProfile[]
}

/** Recursively list files under a directory as { abs, rel } (rel uses "/"). */
function walk(root: string): { abs: string; rel: string }[] {
  const out: { abs: string; rel: string }[] = []
  const rec = (dir: string, prefix: string) => {
    let items: fs.Dirent[]
    try {
      items = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const it of items) {
      const abs = path.join(dir, it.name)
      const rel = prefix ? `${prefix}/${it.name}` : it.name
      if (it.isDirectory()) rec(abs, rel)
      else if (it.isFile()) out.push({ abs, rel })
    }
  }
  rec(root, '')
  return out
}

function safeExt(p: string): string {
  const e = path.extname(p)
  return e && e.length <= 6 ? e : ''
}

/**
 * Write a complete backup to destPath. `now` is passed in (ISO string) so the
 * container is deterministic for tests. Returns a short summary of what went in.
 */
export function exportBackup(args: { destPath: string; passphrase: string; now: string }): {
  ok: boolean
  message: string
} {
  if (!args.passphrase || args.passphrase.length < 4)
    return { ok: false, message: 'Choose a password of at least 4 characters — it protects your API keys.' }

  const { userData } = getStoragePaths()
  const settings = getSettings()
  const voiceProfiles = listProfiles()
  const musicProfiles = listMusic()

  const config: ConfigBlob = { settings, voiceProfiles, musicProfiles }
  const entries: BackupEntry[] = [
    { name: CONFIG, data: encryptBlob(Buffer.from(JSON.stringify(config), 'utf8'), args.passphrase), enc: true }
  ]

  let musicCount = 0
  for (const m of musicProfiles) {
    if (m.path && fs.existsSync(m.path)) {
      try {
        entries.push({ name: `${MUSIC_PREFIX}${m.id}${safeExt(m.path)}`, data: fs.readFileSync(m.path) })
        musicCount++
      } catch {
        /* skip an unreadable music file */
      }
    }
  }

  for (const [key, p] of [
    ['background_music', settings.background_music_path],
    ['transition_sound', settings.transition_sound_path]
  ] as const) {
    if (p && fs.existsSync(p)) {
      try {
        entries.push({ name: `${GLOBAL_PREFIX}${key}${safeExt(p)}`, data: fs.readFileSync(p) })
      } catch {
        /* skip */
      }
    }
  }

  const tplRoot = path.join(userData, 'template-assets')
  let tplCount = 0
  for (const f of walk(tplRoot)) {
    try {
      entries.push({ name: `${TPL_PREFIX}${f.rel}`, data: fs.readFileSync(f.abs) })
      tplCount++
    } catch {
      /* skip */
    }
  }

  const buf = packContainer(entries, args.now)
  fs.writeFileSync(args.destPath, buf)
  const mb = (buf.length / (1024 * 1024)).toFixed(1)
  return {
    ok: true,
    message: `Backup saved (${mb} MB): keys + settings, ${voiceProfiles.length} voice profile(s), ${musicCount} music file(s), ${tplCount} template image(s). Keep this file and its password safe.`
  }
}

/**
 * Restore a backup from srcPath. Copies bundled assets into userData and
 * rewrites the machine-specific paths so they resolve on this PC. Returns a
 * summary; a wrong password fails cleanly without changing anything.
 */
export function importBackup(args: { srcPath: string; passphrase: string }): { ok: boolean; message: string } {
  let buf: Buffer
  try {
    buf = fs.readFileSync(args.srcPath)
  } catch (err: any) {
    return { ok: false, message: `Could not read the backup file: ${err?.message ?? err}` }
  }

  let container: ReturnType<typeof unpackContainer>
  try {
    container = unpackContainer(buf)
  } catch (err: any) {
    return { ok: false, message: `Not a valid backup file: ${err?.message ?? err}` }
  }

  const encConfig = container.get(CONFIG)
  if (!encConfig) return { ok: false, message: 'Backup is missing its config section.' }
  let config: ConfigBlob
  try {
    config = JSON.parse(decryptBlob(encConfig, args.passphrase).toString('utf8'))
  } catch {
    return { ok: false, message: 'Wrong password, or the backup file is corrupted. Nothing was changed.' }
  }

  // Everything past here is trusted — write assets, then rewrite paths.
  const { userData } = getStoragePaths()
  const assetsDir = path.join(userData, 'restored-assets')
  fs.mkdirSync(path.join(assetsDir, 'music'), { recursive: true })

  const musicProfiles = Array.isArray(config.musicProfiles) ? config.musicProfiles : []
  let musicCount = 0
  for (const e of container.manifest.entries) {
    if (!e.name.startsWith(MUSIC_PREFIX)) continue
    const data = container.get(e.name)
    if (!data) continue
    const file = e.name.slice(MUSIC_PREFIX.length) // "<id><ext>"
    const id = file.replace(/\.[^.]*$/, '')
    const dest = path.join(assetsDir, 'music', file)
    try {
      fs.writeFileSync(dest, data)
      const prof = musicProfiles.find((m) => m.id === id)
      if (prof) prof.path = dest
      musicCount++
    } catch {
      /* skip */
    }
  }

  const settings = config.settings ?? getSettings()
  for (const e of container.manifest.entries) {
    if (!e.name.startsWith(GLOBAL_PREFIX)) continue
    const data = container.get(e.name)
    if (!data) continue
    const file = e.name.slice(GLOBAL_PREFIX.length) // "background_music.ext" | "transition_sound.ext"
    const dest = path.join(assetsDir, file)
    try {
      fs.writeFileSync(dest, data)
      if (file.startsWith('background_music')) settings.background_music_path = dest
      else if (file.startsWith('transition_sound')) settings.transition_sound_path = dest
    } catch {
      /* skip */
    }
  }

  let tplCount = 0
  for (const e of container.manifest.entries) {
    if (!e.name.startsWith(TPL_PREFIX)) continue
    const data = container.get(e.name)
    if (!data) continue
    const rel = e.name.slice(TPL_PREFIX.length)
    // Guard against path traversal from a hand-edited backup.
    if (rel.includes('..')) continue
    const dest = path.join(userData, 'template-assets', rel)
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, data)
      tplCount++
    } catch {
      /* skip */
    }
  }

  // Commit config LAST, once assets are on disk and paths are rewritten.
  setSettings(settings)
  if (Array.isArray(config.voiceProfiles)) replaceProfiles(config.voiceProfiles)
  replaceMusicProfiles(musicProfiles)

  return {
    ok: true,
    message: `Restored: keys + settings, ${config.voiceProfiles?.length ?? 0} voice profile(s), ${musicCount} music file(s), ${tplCount} template image(s). You're ready to render on this PC.`
  }
}
