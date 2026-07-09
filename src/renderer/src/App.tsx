import { useEffect, useState } from 'react'
import type { Job } from '../../shared/types'
import QueuePage from './pages/QueuePage'
import NewJobPage from './pages/NewJobPage'
import SettingsPage from './pages/SettingsPage'
import VoiceProfilesPage from './pages/VoiceProfilesPage'
import MusicPage from './pages/MusicPage'

type Tab = 'queue' | 'new' | 'profiles' | 'music' | 'settings'
export type PreviewStatus = { text: string; done: boolean; ok?: boolean; path?: string }

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('queue')
  const [jobs, setJobs] = useState<Job[]>([])
  // Script-factory / preview progress. Subscribed HERE (App never unmounts) so
  // events keep updating even while the user is on another tab — otherwise the
  // status froze at whatever message was current when New Job unmounted.
  const [preview, setPreview] = useState<PreviewStatus | null>(null)

  // Prevent the window from navigating away when a file is dropped anywhere
  // (Electron's default). Drop zones handle their own drops on top of this.
  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  useEffect(() => {
    window.api.jobs.list().then(setJobs)
    const off = window.api.jobs.onEvent((event) => {
      setJobs((prev) => {
        if (event.type === 'removed') return prev.filter((j) => j.id !== event.job.id)
        const next = prev.slice()
        const idx = next.findIndex((j) => j.id === event.job.id)
        if (idx >= 0) next[idx] = event.job
        else next.unshift(event.job)
        return next
      })
    })
    return () => off()
  }, [])

  useEffect(() => {
    const unsub = window.api.preview?.onEvent?.((ev) => setPreview(ev))
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  const activeCount = jobs.filter(
    (j) => j.status === 'queued' || j.status === 'running'
  ).length

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>
          AI <span className="accent">Video</span> Creator
        </h1>
        <button
          className={`nav-btn ${tab === 'queue' ? 'active' : ''}`}
          onClick={() => setTab('queue')}
        >
          Queue
          {activeCount > 0 && <span className="badge">{activeCount}</span>}
        </button>
        <button
          className={`nav-btn ${tab === 'new' ? 'active' : ''}`}
          onClick={() => setTab('new')}
        >
          New job
        </button>
        <button
          className={`nav-btn ${tab === 'profiles' ? 'active' : ''}`}
          onClick={() => setTab('profiles')}
        >
          Voice profiles
        </button>
        <button
          className={`nav-btn ${tab === 'music' ? 'active' : ''}`}
          onClick={() => setTab('music')}
        >
          Background music
        </button>
        <button
          className={`nav-btn ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
        >
          Settings
        </button>
        {preview && (
          <div
            className={`factory-status ${preview.done ? (preview.ok ? 'ok' : 'err') : 'busy'}`}
            style={{
              marginTop: 'auto',
              fontSize: 12,
              lineHeight: 1.4,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(255,255,255,.05)'
            }}
            title={preview.text}
          >
            <div style={{ fontWeight: 600, marginBottom: 2 }}>
              {preview.done ? (preview.ok ? '✓ Scripts' : '✕ Scripts') : '⏳ Writing scripts…'}
            </div>
            <div style={{ opacity: 0.85, maxHeight: 54, overflow: 'hidden' }}>{preview.text}</div>
            {preview.done && (
              <button
                className="ghost"
                style={{ marginTop: 6, padding: '2px 8px', fontSize: 11 }}
                onClick={() => setPreview(null)}
              >
                Dismiss
              </button>
            )}
          </div>
        )}
      </aside>
      <main className="content">
        {tab === 'queue' && <QueuePage jobs={jobs} />}
        {tab === 'new' && (
          <NewJobPage onQueued={() => setTab('queue')} preview={preview} setPreview={setPreview} />
        )}
        {tab === 'profiles' && <VoiceProfilesPage />}
        {tab === 'music' && <MusicPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}
