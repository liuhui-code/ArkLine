import { spawn } from "node:child_process"
import readline from "node:readline"

export class SemanticWorkerClient {
  constructor(workerEntry, options = {}) {
    this.workerEntry = workerEntry
    this.spawnCommand = options.spawnCommand ?? process.execPath
    this.spawnArgs = options.spawnArgs ?? [workerEntry]
    this.spawnOptions = options.spawnOptions ?? {}
    this.spawn = options.spawn ?? spawn
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.pending = new Map()
    this.stderr = ""
    this.closed = false

    this.process = this.spawn(this.spawnCommand, this.spawnArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      ...this.spawnOptions,
    })

    this.reader = readline.createInterface({
      input: this.process.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    })

    this.reader.on("line", (line) => this.handleLine(line))
    this.process.stderr?.on("data", (chunk) => {
      this.stderr += String(chunk)
    })
    this.process.on("error", (error) => this.rejectPending(error))
    this.process.on("exit", (code, signal) => {
      this.closed = true
      if (this.pending.length > 0) {
        this.rejectPending(new Error(`Semantic worker exited before responding (code ${code}, signal ${signal})`))
      }
    })
  }

  request(payload) {
    if (this.closed) {
      return Promise.reject(new Error("Semantic worker is closed"))
    }
    if (!payload || typeof payload.id !== "string" || payload.id.length === 0) {
      return Promise.reject(new Error("Semantic request payload requires a string id"))
    }
    if (this.pending.has(payload.id)) {
      return Promise.reject(new Error(`Duplicate semantic request id: ${payload.id}`))
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(payload.id)
        reject(new Error(`Semantic worker request timed out: ${payload.id}`))
      }, this.timeoutMs)

      this.pending.set(payload.id, { resolve, reject, timeout })
      this.process.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (error) {
          const pending = this.pending.get(payload.id)
          if (pending) {
            clearTimeout(pending.timeout)
            this.pending.delete(payload.id)
            pending.reject(error)
          }
        }
      })
    })
  }

  close() {
    this.closed = true
    this.reader.close()
    this.rejectPending(new Error("Semantic worker client closed"))

    return new Promise((resolve) => {
      if (this.process.exitCode !== null || this.process.killed) {
        resolve()
        return
      }

      this.process.once("exit", () => resolve())
      this.process.stdin.end()
      this.process.kill()
    })
  }

  handleLine(line) {
    let response
    try {
      response = JSON.parse(line)
    } catch (error) {
      this.rejectPending(new Error(`Invalid semantic worker response JSON: ${error instanceof Error ? error.message : String(error)}`))
      return
    }

    if (!response || typeof response.id !== "string" || response.id.length === 0) {
      this.rejectPending(new Error("Semantic worker response missing string id"))
      return
    }

    const pending = this.pending.get(response.id)
    if (!pending) {
      this.rejectPending(new Error(`Semantic worker returned unknown response id: ${response.id}`))
      return
    }

    clearTimeout(pending.timeout)
    this.pending.delete(response.id)
    pending.resolve(response)
  }

  rejectPending(error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      this.pending.delete(id)
      pending.reject(error)
    }
  }
}
