import fs from "fs";
import path from "path";
import { RawEvent } from "./types";

const DEFAULT_LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), "logs");

export function ensureLogDir(logDir = DEFAULT_LOG_DIR) {
  fs.mkdirSync(logDir, { recursive: true });
}

export function logEvent(event: RawEvent, logDir = DEFAULT_LOG_DIR) {
  ensureLogDir(logDir);
  const eventsLog = path.join(logDir, "events.jsonl");
  fs.appendFileSync(eventsLog, JSON.stringify(event) + "\n");
}
