import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../shared/types'

export default function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [ttsCheck, setTtsCheck] = useState<{ ok: boolean; detail?: string } | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    window.api.settings.get().then(setSettings)
  }, [])

  if (!settings) return <div className="muted">Loading…</div>

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings({ ...settings!, [key]: value })
    setSavedMsg(null)
  }

  async function save() {
    const next = await window.api.settings.set(settings!)
    setSettings(next)
    setSavedMsg('Settings saved.')
  }

  async function pickFolder() {
    const folder = await window.api.dialog.pickFolder(settings!.default_output_folder)
    if (folder) update('default_output_folder', folder)
  }

  async function testTts() {
    setChecking(true)
    setTtsCheck(null)
    await window.api.settings.set(settings!)
    const r = await window.api.tts.health()
    setTtsCheck(r)
    setChecking(false)
  }

  return (
    <>
      <h2>Settings</h2>
      <div className="sub">
        Stored in your user data folder. API keys are kept locally — never sent anywhere except the services they belong to.
      </div>

      {savedMsg && <div className="banner ok">{savedMsg}</div>}

      <div className="card">
        <h3>Claude (Anthropic)</h3>
        <div className="row">
          <label className="field grow">
            API key
            <input
              type="password"
              value={settings.anthropic_api_key}
              onChange={(e) => update('anthropic_api_key', e.target.value)}
              placeholder="sk-ant-…"
            />
          </label>
          <label className="field" style={{ width: 220 }}>
            Model
            <input
              type="text"
              value={settings.claude_model}
              onChange={(e) => update('claude_model', e.target.value)}
              placeholder="claude-opus-4-7"
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h3>Voice / TTS server</h3>
        <div className="row">
          <label className="field grow">
            Base URL
            <input
              type="text"
              value={settings.tts_base_url}
              onChange={(e) => update('tts_base_url', e.target.value)}
              placeholder="http://localhost:8000 or https://…trycloudflare.com"
            />
          </label>
          <label className="field grow">
            API key
            <input
              type="password"
              value={settings.tts_api_key}
              onChange={(e) => update('tts_api_key', e.target.value)}
              placeholder="vct_…"
            />
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="secondary" onClick={testTts} disabled={checking}>
            {checking ? 'Checking…' : 'Test connection'}
          </button>
          {ttsCheck && (
            <div className={`banner ${ttsCheck.ok ? 'ok' : 'err'}`} style={{ margin: 0 }}>
              {ttsCheck.ok ? 'TTS server is healthy.' : `Failed: ${ttsCheck.detail}`}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Output and tools</h3>
        <label className="field">
          Default output folder
          <div className="path-row">
            <input
              type="text"
              value={settings.default_output_folder}
              onChange={(e) => update('default_output_folder', e.target.value)}
            />
            <button className="secondary" onClick={pickFolder}>Choose…</button>
          </div>
        </label>
        <label className="field" style={{ marginTop: 12 }}>
          Hyperframes command
          <input
            type="text"
            value={settings.hyperframes_command}
            onChange={(e) => update('hyperframes_command', e.target.value)}
            placeholder="npx hyperframes"
          />
          <span className="hint">
            Usually <span className="code-inline">npx hyperframes</span>. Use an absolute path if Node/npx isn't in PATH.
          </span>
        </label>
      </div>

      <div className="row">
        <button onClick={save}>Save settings</button>
      </div>
    </>
  )
}
