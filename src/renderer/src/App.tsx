import { useEffect, useState } from 'react'
import type { Job } from '../../shared/types'
import QueuePage from './pages/QueuePage'
import NewJobPage from './pages/NewJobPage'
import SettingsPage from './pages/SettingsPage'
import VoiceProfilesPage from './pages/VoiceProfilesPage'

type Tab = 'queue' | 'new' | 'profiles' | 'settings'

export default function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('queue')
  const [jobs, setJobs] = useState<Job[]>([])

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
          className={`nav-btn ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
        >
          Settings
        </button>
      </aside>
      <main className="content">
        {tab === 'queue' && <QueuePage jobs={jobs} />}
        {tab === 'new' && <NewJobPage onQueued={() => setTab('queue')} />}
        {tab === 'profiles' && <VoiceProfilesPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}
