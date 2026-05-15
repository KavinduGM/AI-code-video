import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Job, JobLogEntry, JobStatus } from '@shared/types'
import { getStoragePaths } from './settings'

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (!db) {
    const { db: dbPath, workspace } = getStoragePaths()
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    fs.mkdirSync(workspace, { recursive: true })
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        script_yaml TEXT NOT NULL,
        script_path TEXT,
        video_name TEXT NOT NULL,
        output_path TEXT,
        error TEXT,
        progress REAL NOT NULL DEFAULT 0,
        current_step TEXT,
        logs TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
    `)
    // If app crashed mid-run, reset running jobs back to queued on boot.
    db.prepare(`UPDATE jobs SET status='queued', current_step=NULL, progress=0 WHERE status='running'`).run()
  }
  return db
}

function rowToJob(row: any): Job {
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    status: row.status as JobStatus,
    script_yaml: row.script_yaml,
    script_path: row.script_path ?? undefined,
    video_name: row.video_name,
    output_path: row.output_path ?? undefined,
    error: row.error ?? undefined,
    progress: row.progress,
    current_step: row.current_step ?? undefined,
    logs: JSON.parse(row.logs ?? '[]') as JobLogEntry[]
  }
}

export function createJob(input: {
  video_name: string
  script_yaml: string
  script_path?: string
}): Job {
  const now = Date.now()
  const job: Job = {
    id: randomUUID(),
    created_at: now,
    updated_at: now,
    status: 'queued',
    script_yaml: input.script_yaml,
    script_path: input.script_path,
    video_name: input.video_name,
    progress: 0,
    logs: []
  }
  getDb()
    .prepare(
      `INSERT INTO jobs (id, created_at, updated_at, status, script_yaml, script_path, video_name, progress, logs)
       VALUES (@id, @created_at, @updated_at, @status, @script_yaml, @script_path, @video_name, @progress, @logs)`
    )
    .run({
      ...job,
      script_path: job.script_path ?? null,
      logs: JSON.stringify(job.logs)
    })
  return job
}

export function listJobs(): Job[] {
  const rows = getDb().prepare(`SELECT * FROM jobs ORDER BY created_at DESC`).all()
  return rows.map(rowToJob)
}

export function getJob(id: string): Job | null {
  const row = getDb().prepare(`SELECT * FROM jobs WHERE id = ?`).get(id)
  return row ? rowToJob(row) : null
}

export function nextQueuedJob(): Job | null {
  const row = getDb()
    .prepare(`SELECT * FROM jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1`)
    .get()
  return row ? rowToJob(row) : null
}

export function updateJob(
  id: string,
  patch: Partial<Pick<Job, 'status' | 'progress' | 'current_step' | 'error' | 'output_path'>>
): Job | null {
  const existing = getJob(id)
  if (!existing) return null
  const next: Job = { ...existing, ...patch, updated_at: Date.now() }
  getDb()
    .prepare(
      `UPDATE jobs SET status=@status, progress=@progress, current_step=@current_step,
       error=@error, output_path=@output_path, updated_at=@updated_at WHERE id=@id`
    )
    .run({
      id: next.id,
      status: next.status,
      progress: next.progress,
      current_step: next.current_step ?? null,
      error: next.error ?? null,
      output_path: next.output_path ?? null,
      updated_at: next.updated_at
    })
  return next
}

export function appendLog(id: string, entry: JobLogEntry): Job | null {
  const job = getJob(id)
  if (!job) return null
  const nextLogs = [...job.logs, entry].slice(-500)
  getDb().prepare(`UPDATE jobs SET logs=?, updated_at=? WHERE id=?`).run(JSON.stringify(nextLogs), Date.now(), id)
  return getJob(id)
}

export function deleteJob(id: string): void {
  getDb().prepare(`DELETE FROM jobs WHERE id=?`).run(id)
}

export function resetJob(id: string): Job | null {
  return updateJob(id, {
    status: 'queued',
    progress: 0,
    current_step: undefined,
    error: undefined,
    output_path: undefined
  })
}
