import readline from "node:readline"

import type { SemanticRequest, SemanticResponse } from "./protocol.js"
import { SemanticWorkerSession } from "./session.js"

const session = new SemanticWorkerSession()

function writeResponse(response: SemanticResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`)
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY,
})

rl.on("line", (line) => {
  if (!line.trim()) {
    return
  }

  try {
    const request = JSON.parse(line) as SemanticRequest
    writeResponse(session.handle(request))
  } catch (error) {
    writeResponse({
      id: "invalid",
      ok: false,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
