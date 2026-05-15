import { useEffect, useState } from 'react'

export default function NewJobPage({ onQueued }: { onQueued: () => void }): JSX.Element {
  const [yaml, setYaml] = useState('')
  const [template, setTemplate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  useEffect(() => {
    window.api.template.get().then((t) => setTemplate(t))
  }, [])

  async function enqueueText() {
    setError(null)
    setOk(null)
    if (!yaml.trim()) {
      setError('Paste a script first.')
      return
    }
    setBusy(true)
    try {
      const job = await window.api.jobs.enqueue(yaml)
      setOk(`Queued: ${job.video_name}`)
      setYaml('')
      setTimeout(onQueued, 300)
    } catch (err: any) {
      setError(err?.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  async function enqueueFromFiles() {
    setError(null)
    setOk(null)
    const files = await window.api.dialog.pickScripts()
    if (files.length === 0) return
    setBusy(true)
    const queued: string[] = []
    const failed: string[] = []
    for (const f of files) {
      try {
        const job = await window.api.jobs.enqueueFile(f)
        queued.push(job.video_name)
      } catch (err: any) {
        failed.push(`${f}: ${err?.message ?? err}`)
      }
    }
    setBusy(false)
    if (queued.length) setOk(`Queued ${queued.length}: ${queued.join(', ')}`)
    if (failed.length) setError(failed.join('\n'))
    if (queued.length) setTimeout(onQueued, 400)
  }

  return (
    <>
      <h2>New job</h2>
      <div className="sub">
        Paste a script (YAML) or pick one or more script files. Multiple files are queued in order.
      </div>

      {error && <div className="banner err">{error}</div>}
      {ok && <div className="banner ok">{ok}</div>}

      <div className="card">
        <h3>Script</h3>
        <textarea
          spellCheck={false}
          value={yaml}
          placeholder="Paste your YAML script here…"
          onChange={(e) => setYaml(e.target.value)}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={enqueueText} disabled={busy}>
            {busy ? 'Queuing…' : 'Queue this script'}
          </button>
          <button className="secondary" onClick={enqueueFromFiles} disabled={busy}>
            Pick file(s) and queue
          </button>
          <button
            className="ghost"
            onClick={() => setYaml(template)}
            disabled={!template}
          >
            Load template
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Template</h3>
        <div className="muted" style={{ marginBottom: 8 }}>
          Save this as <span className="code-inline">my-video.yml</span> and edit per video. The exact format the parser expects.
        </div>
        <pre className="logs" style={{ maxHeight: 360 }}>
          {template || '(loading…)'}
        </pre>
      </div>
    </>
  )
}
