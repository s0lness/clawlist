import { AgentConfig, RawEvent } from "./types";
import { logEvent } from "./log";
import { MatrixTransport } from "./transports/matrix";
import { loadConfig } from "./config";
import { postJson } from "./http";
import { logError, logInfo, logWarn } from "./logger";

export function startAgent(configPath: string) {
  const config = loadConfig(configPath);
  const transport = new MatrixTransport(configPath);
  const logDir = config.log_dir ?? "logs";
  const redact = config.log_redact ?? "none";
  const openclawUrl = config.openclaw_url;
  const openclawToken = config.openclaw_token;
  const openclawTimeoutMs = config.openclaw_timeout_ms ?? 5000;
  const openclawRetryMax = config.openclaw_retry_max ?? 3;
  const openclawRetryDelayMs = config.openclaw_retry_delay_ms ?? 1000;
  const openclawQueueMax = config.openclaw_queue_max ?? 100;
  const rateLimitPerSec = config.rate_limit_per_sec ?? 20;
  const dedupeTtlMs = config.dedupe_ttl_ms ?? 5 * 60 * 1000;

  type QueueItem = { event: RawEvent; attempt: number };
  const queue: QueueItem[] = [];
  let processing = false;
  let shuttingDown = false;

  let tokens = rateLimitPerSec;
  let lastRefill = Date.now();
  const seen = new Map<string, number>();
  let seenChecks = 0;

  function eventKey(event: RawEvent): string {
    return event.event_id ?? `${event.ts}|${event.from}|${event.channel}|${event.body}`;
  }

  function isDuplicate(event: RawEvent): boolean {
    if (dedupeTtlMs <= 0) return false;
    const key = eventKey(event);
    const now = Date.now();
    const prev = seen.get(key);
    if (prev && now - prev < dedupeTtlMs) return true;
    seen.set(key, now);
    seenChecks += 1;
    if (seenChecks % 200 === 0) {
      for (const [k, ts] of seen.entries()) {
        if (now - ts > dedupeTtlMs) seen.delete(k);
      }
    }
    return false;
  }

  function allowRate(): boolean {
    if (rateLimitPerSec <= 0) return true;
    const now = Date.now();
    const elapsed = now - lastRefill;
    if (elapsed >= 1000) {
      const refill = Math.floor(elapsed / 1000) * rateLimitPerSec;
      tokens = Math.min(rateLimitPerSec, tokens + refill);
      lastRefill = now;
    }
    if (tokens <= 0) return false;
    tokens -= 1;
    return true;
  }

  function enqueue(event: RawEvent) {
    if (queue.length >= openclawQueueMax) {
      logWarn("OpenClaw queue full, dropping event", { queue_size: queue.length });
      return;
    }
    queue.push({ event, attempt: 0 });
    void processQueue();
  }

  function scheduleRetry(item: QueueItem) {
    if (shuttingDown) return;
    if (item.attempt >= openclawRetryMax) {
      logError("OpenClaw retries exhausted", { attempts: item.attempt });
      return;
    }
    const delay = openclawRetryDelayMs * Math.pow(2, item.attempt);
    setTimeout(() => {
      queue.push({ event: item.event, attempt: item.attempt + 1 });
      void processQueue();
    }, delay);
  }

  async function processQueue() {
    if (processing) return;
    processing = true;
    while (queue.length > 0 && !shuttingDown) {
      const item = queue.shift();
      if (!item || !openclawUrl) continue;
      const headers: Record<string, string> = {};
      if (openclawToken) {
        headers.Authorization = `Bearer ${openclawToken}`;
      }
      try {
        await postJson(openclawUrl, { event: item.event }, headers, openclawTimeoutMs);
      } catch (err) {
        logWarn("OpenClaw notify failed, scheduling retry", {
          error: errorMessage(err),
          attempt: item.attempt,
        });
        scheduleRetry(item);
      }
    }
    processing = false;
  }

  async function drainQueue(timeoutMs = 5000) {
    const start = Date.now();
    while (queue.length > 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (queue.length > 0) {
      logWarn("Shutdown before queue drained", { remaining: queue.length });
    }
  }

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logInfo("Shutdown requested", { signal });
    if (transport.stop) {
      await transport.stop();
    }
    await drainQueue(5000);
    process.exit(0);
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  function errorMessage(err: unknown): string {
    if (err instanceof Error && err.message) return err.message;
    return String(err);
  }

  async function handleEvent(event: RawEvent) {
    logEvent(event, logDir, redact);
    if (openclawUrl) {
      if (!allowRate()) {
        logWarn("Rate limit exceeded, dropping OpenClaw notify");
        return;
      }
      if (isDuplicate(event)) {
        logWarn("Duplicate event, skipping OpenClaw notify");
        return;
      }
      enqueue(event);
    }
  }

  transport.start(handleEvent);

  logInfo("Agent running", { user_id: config.user_id });
}
