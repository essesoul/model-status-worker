import { spawn } from "node:child_process";

const wranglerArgs = ["wrangler", "dev", "-c", "wrangler.jsonc", "--local", "--test-scheduled"];
const wranglerCommand = process.platform === "win32" ? "cmd.exe" : "npx";
const wranglerCommandArgs = process.platform === "win32"
  ? ["/d", "/s", "/c", `npx ${wranglerArgs.join(" ")}`]
  : wranglerArgs;

const cronPattern = (process.env.DEV_CRON_PATTERN ?? "* * * * *").trim() || "* * * * *";
const requestedIntervalMs = Number.parseInt(process.env.DEV_CRON_INTERVAL_MS ?? "", 10);
const cronIntervalMs = Number.isFinite(requestedIntervalMs) && requestedIntervalMs > 0 ? requestedIntervalMs : 60_000;

const scheduledPaths = [
  "/cdn-cgi/handler/scheduled",
  "/__scheduled",
];

let baseUrl = null;
let triggerTimer = null;
let scheduledReady = false;
let triggerInFlight = false;
let shuttingDown = false;

function log(message) {
  console.log(`[dev-cron] ${message}`);
}

function previewBody(body) {
  const trimmed = body.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.length <= 120 ? trimmed : `${trimmed.slice(0, 120)}...`;
}

async function triggerScheduled(reason) {
  if (!baseUrl || triggerInFlight) {
    return;
  }

  triggerInFlight = true;

  try {
    let lastFailure = "scheduled route unavailable";

    for (const path of scheduledPaths) {
      const url = new URL(path, baseUrl);
      url.searchParams.set("cron", cronPattern);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "model-status-worker-local-cron",
          },
        });

        const contentType = response.headers.get("content-type") ?? "";
        const body = await response.text();
        const looksLikeHtml = /text\/html/i.test(contentType) || /<!doctype html>/i.test(body);

        if (response.ok && !looksLikeHtml) {
          const bodySuffix = previewBody(body);
          log(`Triggered scheduled handler via ${path} (${reason})${bodySuffix ? `: ${bodySuffix}` : ""}`);
          scheduledReady = true;
          return;
        }

        lastFailure = `${path} returned ${response.status}${looksLikeHtml ? " with HTML fallback" : ""}${body ? `: ${previewBody(body)}` : ""}`;
      } catch (error) {
        lastFailure = `${path} failed: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        clearTimeout(timeout);
      }
    }

    log(`Scheduled trigger skipped (${reason}): ${lastFailure}`);
  } finally {
    triggerInFlight = false;
  }
}

function startCronLoop() {
  if (triggerTimer) {
    return;
  }

  log(`Cron simulation enabled for local dev. Pattern: "${cronPattern}", interval: ${cronIntervalMs}ms.`);

  setTimeout(() => {
    void triggerScheduled("startup");
  }, 1_000);

  triggerTimer = setInterval(() => {
    void triggerScheduled("interval");
  }, cronIntervalMs);
}

function stopCronLoop() {
  if (triggerTimer) {
    clearInterval(triggerTimer);
    triggerTimer = null;
  }
}

function handleOutput(chunk, writer) {
  const text = chunk.toString();
  writer.write(text);

  const readyMatch = text.match(/Ready on (https?:\/\/[^\s]+)/);
  if (readyMatch) {
    baseUrl = readyMatch[1];
    startCronLoop();
  }
}

const wrangler = spawn(wranglerCommand, wranglerCommandArgs, {
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

wrangler.stdout.on("data", (chunk) => {
  handleOutput(chunk, process.stdout);
});

wrangler.stderr.on("data", (chunk) => {
  handleOutput(chunk, process.stderr);
});

wrangler.on("exit", (code, signal) => {
  stopCronLoop();

  if (shuttingDown) {
    process.exit(0);
  }

  if (!scheduledReady) {
    log("Wrangler exited before the local scheduled test route became available.");
  }

  if (signal) {
    process.exit(0);
  }

  process.exit(code ?? 0);
});

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  stopCronLoop();
  log(`Stopping local dev (${signal}).`);

  if (!wrangler.killed) {
    wrangler.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
