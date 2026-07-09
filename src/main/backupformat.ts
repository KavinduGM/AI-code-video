// =====================================================================
// BACKUP CONTAINER FORMAT + ENCRYPTION  (pure Node, no Electron)
// =====================================================================
// A backup is ONE self-contained file the user can keep in any cloud drive
// and import on another PC. Layout:
//
//   MAGIC "AIVBK001"            (8 bytes)
//   uint32 BE manifestLen       (4 bytes)
//   manifest JSON               (manifestLen bytes, utf8)
//   entry payloads              (concatenated, in manifest order)
//
// The `config` entry (settings + voice/music profiles — which include the API
// keys and voice IDs) is ENCRYPTED with AES-256-GCM, keyed from the user's
// passphrase via scrypt. Binary assets (music files, template PNGs) are stored
// as-is (they aren't secret). Kept free of Electron imports so the format is
// unit-testable with plain node.
// =====================================================================

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto'

const MAGIC = Buffer.from('AIVBK001', 'ascii') // 8 bytes
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16

export interface BackupEntry {
  name: string
  data: Buffer
  enc?: boolean
}
export interface BackupManifestEntry {
  name: string
  size: number
  enc?: boolean
}
export interface BackupManifest {
  version: number
  createdAt: string
  app: string
  entries: BackupManifestEntry[]
}

/** Encrypt a blob with a passphrase → salt | iv | authTag | ciphertext. */
export function encryptBlob(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(SALT_LEN)
  const key = scryptSync(passphrase, salt, 32)
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([salt, iv, tag, ct])
}

/**
 * Decrypt a blob produced by encryptBlob. Throws on a wrong passphrase or a
 * tampered/corrupt payload (GCM auth failure) — callers turn that into a
 * friendly "wrong password or corrupted file" message.
 */
export function decryptBlob(blob: Buffer, passphrase: string): Buffer {
  if (blob.length < SALT_LEN + IV_LEN + TAG_LEN) throw new Error('encrypted blob too short')
  const salt = blob.subarray(0, SALT_LEN)
  const iv = blob.subarray(SALT_LEN, SALT_LEN + IV_LEN)
  const tag = blob.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN)
  const ct = blob.subarray(SALT_LEN + IV_LEN + TAG_LEN)
  const key = scryptSync(passphrase, salt, 32)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}

/** Serialise entries into the container byte layout. */
export function packContainer(entries: BackupEntry[], createdAt: string): Buffer {
  const manifest: BackupManifest = {
    version: 1,
    createdAt,
    app: 'ai-video-creator',
    entries: entries.map((e) => ({ name: e.name, size: e.data.length, ...(e.enc ? { enc: true } : {}) }))
  }
  const manifestBuf = Buffer.from(JSON.stringify(manifest), 'utf8')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(manifestBuf.length, 0)
  return Buffer.concat([MAGIC, lenBuf, manifestBuf, ...entries.map((e) => e.data)])
}

/** Parse a container; returns the manifest and a lookup for each entry's bytes. */
export function unpackContainer(buf: Buffer): { manifest: BackupManifest; get: (name: string) => Buffer | undefined } {
  if (buf.length < MAGIC.length + 4 || !buf.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error('not an AI Video Creator backup file')
  const manifestLen = buf.readUInt32BE(MAGIC.length)
  const mStart = MAGIC.length + 4
  const manifest = JSON.parse(buf.subarray(mStart, mStart + manifestLen).toString('utf8')) as BackupManifest
  if (!manifest?.entries || !Array.isArray(manifest.entries)) throw new Error('backup manifest is malformed')
  const map = new Map<string, Buffer>()
  let offset = mStart + manifestLen
  for (const e of manifest.entries) {
    map.set(e.name, buf.subarray(offset, offset + e.size))
    offset += e.size
  }
  return { manifest, get: (name: string) => map.get(name) }
}
