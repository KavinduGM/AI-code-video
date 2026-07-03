import { useEffect, useState } from 'react'
import type { MusicProfile } from '../../../shared/types'

const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|flac)$/i

export default function MusicPage(): JSX.Element {
  const [items, setItems] = useState<MusicProfile[]>([])
  const [name, setName] = useState('')
  const [filePath, setFilePath] = useState('')
  const [error, setError] = useState<string | null>(null)

  function reload() {
    window.api.music.list().then(setItems)
  }
  useEffect(reload, [])

  async function pickFile() {
    setError(null)
    if (typeof window.api?.dialog?.pickAudio !== 'function') {
      setError('Audio picker not loaded — fully quit and restart the app so the updated preload loads.')
      return
    }
    try {
      const f = await window.api.dialog.pickAudio()
      if (f) setFilePath(f)
    } catch (err: any) {
      setError('Could not open the audio picker: ' + (err?.message ?? String(err)))
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setError(null)
    const f = e.dataTransfer.files?.[0]
    if (!f) return
    const p = window.api.getPathForFile?.(f) || (f as unknown as { path?: string }).path || ''
    if (!p) {
      setError('Could not read the dropped file path — use the “Choose file” button instead.')
      return
    }
    if (!AUDIO_RE.test(p)) {
      setError('Please drop an audio file (mp3, wav, m4a, aac, ogg, or flac).')
      return
    }
    setFilePath(p)
  }

  async function add() {
    setError(null)
    if (!name.trim()) {
      setError('Give the music a name — scripts reference it under background_music.')
      return
    }
    if (!filePath.trim()) {
      setError('Choose or drop an audio file.')
      return
    }
    await window.api.music.upsert({ name: name.trim(), path: filePath.trim() })
    setName('')
    setFilePath('')
    reload()
  }

  async function remove(id: string) {
    if (!confirm('Delete this music profile?')) return
    await window.api.music.remove(id)
    reload()
  }

  return (
    <>
      <h2>Background music</h2>
      <div className="sub">
        Save the music tracks you use, each under a name. In a script, reference one by its name in{' '}
        <span className="code-inline">background_music</span>. It plays under the intro &amp; outro at 5%.
      </div>

      {error && <div className="banner err">{error}</div>}

      <div className="card">
        <h3>Add a track</h3>
        <div className="row">
          <label className="field grow">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Channel A Theme"
            />
          </label>
        </div>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          style={{
            marginTop: 10,
            padding: 12,
            border: '1px dashed var(--border, #555)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap'
          }}
        >
          <button className="secondary" onClick={pickFile}>
            {filePath ? 'Change file' : 'Choose file'}
          </button>
          {filePath ? (
            <span className="meta">
              <span className="mono">{filePath.split(/[\\/]/).pop()}</span>{' '}
              <button className="ghost" onClick={() => setFilePath('')}>Clear</button>
            </span>
          ) : (
            <span className="hint">Drag &amp; drop an audio file here, or use the button.</span>
          )}
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          <button onClick={add}>Save track</button>
        </div>
      </div>

      {items.length === 0 && (
        <div className="card">
          <div className="muted">No tracks yet. Add one above.</div>
        </div>
      )}

      {items.map((m) => (
        <div className="profile" key={m.id}>
          <div>
            <div className="title-row">
              <strong>{m.name}</strong>
            </div>
            <div className="meta mono">{m.path}</div>
          </div>
          <div className="actions">
            <button className="danger" onClick={() => remove(m.id)}>Delete</button>
          </div>
        </div>
      ))}
    </>
  )
}
