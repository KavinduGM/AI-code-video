import { useEffect, useState } from 'react'
import type { VoiceProfile } from '../../../shared/types'

const EMPTY: VoiceProfile = {
  id: '',
  name: '',
  description: '',
  voice_id: '',
  default_speed: 1.0,
  default_format: 'mp3'
}

export default function VoiceProfilesPage(): JSX.Element {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([])
  const [editing, setEditing] = useState<VoiceProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  function reload() {
    window.api.profiles.list().then(setProfiles)
  }

  useEffect(reload, [])

  function startNew() {
    setEditing({ ...EMPTY })
    setError(null)
  }

  async function save() {
    if (!editing) return
    if (!editing.name.trim()) {
      setError('Name is required — it is what scripts reference under voice_profile.')
      return
    }
    if (!editing.voice_id.trim()) {
      setError('voice_id is required so the TTS server knows which voice to speak with.')
      return
    }
    await window.api.profiles.upsert(editing)
    setEditing(null)
    reload()
  }

  async function remove(id: string) {
    if (!confirm('Delete this voice profile?')) return
    await window.api.profiles.remove(id)
    reload()
  }

  return (
    <>
      <h2>Voice profiles</h2>
      <div className="sub">
        Save the voices you use most. In a script, reference one by its name in <span className="code-inline">voice_profile</span>.
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <button onClick={startNew}>New profile</button>
      </div>

      {profiles.length === 0 && (
        <div className="card">
          <div className="muted">No profiles yet. Create one with the button above.</div>
        </div>
      )}

      {profiles.map((p) => (
        <div className="profile" key={p.id}>
          <div>
            <div className="title-row">
              <strong>{p.name}</strong>
              <span className="muted">— {p.description || 'no description'}</span>
            </div>
            <div className="meta">
              voice_id: <span className="mono">{p.voice_id}</span> • speed {p.default_speed} • {p.default_format}
            </div>
          </div>
          <div className="actions">
            <button className="secondary" onClick={() => { setEditing(p); setError(null) }}>Edit</button>
            <button className="danger" onClick={() => remove(p.id)}>Delete</button>
          </div>
        </div>
      ))}

      {editing && (
        <div className="modal-bg" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editing.id ? 'Edit profile' : 'New profile'}</h3>
            {error && <div className="banner err">{error}</div>}
            <div className="row">
              <label className="field grow">
                Display name
                <input
                  type="text"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Narrator A"
                />
              </label>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <label className="field grow">
                Description
                <input
                  type="text"
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  placeholder="Calm, deep male, news-anchor pacing"
                />
              </label>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <label className="field grow">
                voice_id
                <input
                  type="text"
                  value={editing.voice_id}
                  onChange={(e) => setEditing({ ...editing, voice_id: e.target.value })}
                  placeholder="e6f31a8c4d92"
                />
              </label>
              <label className="field" style={{ width: 140 }}>
                Speed
                <input
                  type="number"
                  step="0.05"
                  min="0.5"
                  max="2.0"
                  value={editing.default_speed}
                  onChange={(e) =>
                    setEditing({ ...editing, default_speed: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field" style={{ width: 140 }}>
                Format
                <select
                  value={editing.default_format}
                  onChange={(e) =>
                    setEditing({ ...editing, default_format: e.target.value as 'mp3' | 'wav' })
                  }
                >
                  <option value="mp3">mp3</option>
                  <option value="wav">wav</option>
                </select>
              </label>
            </div>
            <div className="actions">
              <button className="ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button onClick={save}>{editing.id ? 'Save' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
