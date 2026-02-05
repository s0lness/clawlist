import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { loadConfig } = require("../dist/config.js") as {
  loadConfig: (configPath: string) => { base_url: string; user_id: string };
};

function writeConfig(dir: string, name: string, obj: Record<string, unknown>): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

test("loadConfig accepts a valid config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlist-test-"));
  const configPath = writeConfig(dir, "config.json", {
    base_url: "http://127.0.0.1:8008",
    user_id: "@agent_a:localhost",
    password: "changeme",
    goals: [],
  });
  const cfg = loadConfig(configPath);
  assert.equal(cfg.base_url, "http://127.0.0.1:8008");
  assert.equal(cfg.user_id, "@agent_a:localhost");
});

test("loadConfig rejects missing password and access_token", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlist-test-"));
  const configPath = writeConfig(dir, "config.json", {
    base_url: "http://127.0.0.1:8008",
    user_id: "@agent_a:localhost",
    goals: [],
  });
  assert.throws(() => loadConfig(configPath), /password/);
});

test("loadConfig rejects invalid log_redact", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawlist-test-"));
  const configPath = writeConfig(dir, "config.json", {
    base_url: "http://127.0.0.1:8008",
    user_id: "@agent_a:localhost",
    password: "changeme",
    log_redact: "maybe",
    goals: [],
  });
  assert.throws(() => loadConfig(configPath), /log_redact/);
});
