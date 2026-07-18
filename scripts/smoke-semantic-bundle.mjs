import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryPath = path.join(projectRoot, "semantic-worker", "bundle", "semantic-worker.cjs");
const child = spawn(process.execPath, [entryPath], {
  stdio: ["pipe", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
let settled = false;

const timeout = setTimeout(() => finish(new Error("Semantic bundle health check timed out")), 5_000);

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  const newline = stdout.indexOf("\n");
  if (newline < 0) return;
  try {
    const response = JSON.parse(stdout.slice(0, newline));
    if (
      response.id !== "bundle-health"
      || !response.ok
      || response.payload?.status !== "ready"
      || response.payload?.protocolVersion !== 3
    ) {
      throw new Error(`Unexpected semantic bundle response: ${stdout.slice(0, newline)}`);
    }
    finish();
  } catch (error) {
    finish(error instanceof Error ? error : new Error(String(error)));
  }
});
child.on("error", finish);
child.on("exit", (code) => {
  if (!settled) finish(new Error(`Semantic bundle exited with ${code}: ${stderr.trim()}`));
});

child.stdin.write(`${JSON.stringify({ id: "bundle-health", method: "health" })}\n`);

function finish(error) {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  child.kill();
  if (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
