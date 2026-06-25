import { spawn } from "node:child_process"
import readline from "node:readline"

export class SemanticWorkerClient {
  constructor(workerEntry, options = {}) {
    this.workerEntry = workerEntry
    this.spawnCommand = options.spawnCommand ?? process.execPath
    this.spawnArgs = options.spawnArgs ?? [workerEntry]
    this.spawnOptions = options.spawnOptions ?? {}
    this.spawn = options.spawn ?? spawn
    this.pending = []
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

    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject })
      this.process.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (error) {
          const pending = this.pending.shift()
          pending?.reject(error)
        }
      })
    })
  }

  close() {
    this.closed = true
    this.reader.close()

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
    const pending = this.pending.shift()
    if (!pending) {
      return
    }

    try {
      pending.resolve(JSON.parse(line))
    } catch (error) {
      pending.reject(error)
    }
  }

  rejectPending(error) {
    while (this.pending.length > 0) {
      this.pending.shift().reject(error)
    }
  }
}
