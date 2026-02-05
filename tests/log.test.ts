import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { logEvent } = require("../dist/log.js") as {
  logEvent: (
    event: {
      ts: string;
      channel: "dm" | "gossip";
      from: string;
      to?: string;
      body: string;
      transport: string;
    },
    dir: string,
    redact: "none" | "dm" | "all"
  ) => void;
};

function readEvents(dir: string): Array<{ body: string }> {
  const data = fs.readFileSync(path.join(dir, "events.jsonl"), "utf8");
  return data
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line: string) => JSON.parse(line) as { body: string });
}

test("logEvent redacts dm messages when configured", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlist-test-"));
  logEvent(
    {
      ts: new Date().toISOString(),
      channel: "dm",
      from: "@a:localhost",
      to: "@b:localhost",
      body: "secret",
      transport: "matrix",
    },
    dir,
    "dm"
  );

  const events = readEvents(dir);
  assert.equal(events.length, 1);
  assert.equal(events[0].body, "[redacted]");
});

test("logEvent leaves gossip messages intact when redacting dm only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlist-test-"));
  logEvent(
    {
      ts: new Date().toISOString(),
      channel: "gossip",
      from: "@a:localhost",
      body: "hello",
      transport: "matrix",
    },
    dir,
    "dm"
  );

  const events = readEvents(dir);
  assert.equal(events.length, 1);
  assert.equal(events[0].body, "hello");
});
