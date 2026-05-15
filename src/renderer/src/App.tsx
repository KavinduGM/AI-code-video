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
