import { EventEmitter } from 'node:events'
import type { Job, QueueEvent } from '@shared/types'
import { appendLog, nextQueuedJob, updateJob } from './db'
import { runJob } from './pipeline/runner'

export class Worker extends EventEmitter {
  private running = false
  private currentJobId: string | null = null
  private cancelToken: { cancelled: boolean } = { cancelled: false }

  start(): void {
    this.tick()
  }

  isRunning(): boolean {
    return this.running
  }

  currentJob(): string | null {
    return this.currentJobId
  }

  cancelCurrent(): boolean {
    if (this.currentJobId) {
      this.cancelToken.cancelled = true
      return true
    }
    return false
  }

  wake(): void {
    this.tick()
  }

  private async tick(): Promise<void> {
    if (this.running) return
    const next = nextQueuedJob()
    if (!next) return
    this.running = true
    this.currentJobId = next.id
    this.cancelToken = { cancelled: false }
    const startJob = updateJob(next.id, { status: 'running', progress: 0, current_step: 'Starting' })
    if (startJob) this.emit('event', { type: 'updated', job: startJob } satisfies QueueEvent)

    try {
      const finalPath = await runJob(
        next,
        {
          onProgress: (progress, step) => {
            const j = updateJob(next.id, { progress, current_step: step })
            if (j) this.emit('event', { type: 'updated', job: j } satisfies QueueEvent)
          },
          onLog: (entry) => {
            const j = appendLog(next.id, entry)
            if (j) this.emit('event', { type: 'updated', job: j } satisfies QueueEvent)
          }
        },
        this.cancelToken
      )

      const done = updateJob(next.id, {
        status: 'completed',
        progress: 1,
        current_step: 'Done',
        output_path: finalPath
      })
      if (done) this.emit('event', { type: 'updated', job: done } satisfies QueueEvent)
    } catch (err: any) {
      const cancelled = this.cancelToken.cancelled || /cancelled/i.test(err?.message ?? '')
      const failed = updateJob(next.id, {
        status: cancelled ? 'cancelled' : 'failed',
        current_step: cancelled ? 'Cancelled' : 'Failed',
        error: err?.message ?? String(err)
      })
      appendLog(next.id, {
        ts: Date.now(),
        level: 'error',
        message: err?.message ?? String(err)
      })
      if (failed) this.emit('event', { type: 'updated', job: failed } satisfies QueueEvent)
    } finally {
      this.running = false
      this.currentJobId = null
      // Pick up the next queued job, if any.
      setImmediate(() => this.tick())
    }
  }
}

export const worker = new Worker()
