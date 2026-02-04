#!/usr/bin/env node
"use strict";

const http = require("http");
const { URL } = require("url");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.GATEWAY_PORT || 3333);
const HOST = process.env.GATEWAY_HOST || "127.0.0.1";
const SECRET = process.env.GATEWAY_SECRET || "devsecret";
const LOG_DIR = process.env.GATEWAY_LOG_DIR || "logs";

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const gossipLog = path.join(LOG_DIR, "gateway-gossip.log");
const dmLog = path.join(LOG_DIR, "gateway-dm.log");
const listingsLog = path.join(LOG_DIR, "gateway-listings.jsonl");

const agentsByToken = new Map(); // token -> agent_id
const agentsById = new Map(); // agent_id -> { token, name, created_at }
const gossipSubscribers = new Set(); // res
const dmSubscribers = new Map(); // agent_id -> Set(res)

function nowIso() {
  return new Date().toISOString();
}

function jsonLine(filePath, payload) {
  fs.appendFileSync(filePath, JSON.stringify(payload) + "\n");
}

function textLine(filePath, line) {
  fs.appendFileSync(filePath, line + "\n");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function authToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

function requireAuth(req, res) {
  const token = authToken(req);
  if (!token || !agentsByToken.has(token)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }
  return { token, agentId: agentsByToken.get(token) };
}

function sseInit(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.write("\n");
}

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function addDmSubscriber(agentId, res) {
  if (!dmSubscribers.has(agentId)) {
    dmSubscribers.set(agentId, new Set());
  }
  dmSubscribers.get(agentId).add(res);
}

function removeSubscriber(set, res) {
  if (!set) return;
  set.delete(res);
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, ts: nowIso() });
  }

  if (req.method === "POST" && url.pathname === "/auth") {
    try {
      const body = await parseBody(req);
      if (body.secret !== SECRET) {
        return sendJson(res, 401, { error: "Invalid secret" });
      }
      const agentId = body.agent_id || randomId("agent");
      const token = randomId("token");
      const name = body.name || agentId;
      agentsByToken.set(token, agentId);
      agentsById.set(agentId, { token, name, created_at: nowIso() });
      return sendJson(res, 200, { agent_id: agentId, access_token: token, name });
    } catch (err) {
      return sendJson(res, 400, { error: "Invalid JSON" });
    }
  }

  if (req.method === "POST" && url.pathname === "/gossip") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const body = await parseBody(req);
      const payload = {
        ts: nowIso(),
        agent_id: auth.agentId,
        body: body.body || "",
        listing: body.listing || null,
        raw: body,
      };
      textLine(gossipLog, `${payload.ts} ${payload.agent_id} ${payload.body}`);
      if (payload.listing) {
        jsonLine(listingsLog, payload);
      }
      gossipSubscribers.forEach((sub) => {
        sseSend(sub, "gossip", payload);
      });
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { error: "Invalid JSON" });
    }
  }

  if (req.method === "POST" && url.pathname === "/dm") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    try {
      const body = await parseBody(req);
      const toAgent = body.to_agent;
      if (!toAgent) {
        return sendJson(res, 400, { error: "to_agent required" });
      }
      const payload = {
        ts: nowIso(),
        from_agent: auth.agentId,
        to_agent: toAgent,
        body: body.body || "",
        raw: body,
      };
      textLine(dmLog, `${payload.ts} ${payload.from_agent} -> ${payload.to_agent} ${payload.body}`);
      const subs = dmSubscribers.get(toAgent);
      if (subs) {
        subs.forEach((sub) => sseSend(sub, "dm", payload));
      }
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { error: "Invalid JSON" });
    }
  }

  if (req.method === "GET" && url.pathname === "/gossip/stream") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    sseInit(res);
    gossipSubscribers.add(res);
    const heartbeat = setInterval(() => {
      res.write(`event: ping\ndata: ${JSON.stringify({ ts: nowIso() })}\n\n`);
    }, 25000);
    req.on("close", () => {
      clearInterval(heartbeat);
      removeSubscriber(gossipSubscribers, res);
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/dm/stream") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    sseInit(res);
    addDmSubscriber(auth.agentId, res);
    const heartbeat = setInterval(() => {
      res.write(`event: ping\ndata: ${JSON.stringify({ ts: nowIso() })}\n\n`);
    }, 25000);
    req.on("close", () => {
      clearInterval(heartbeat);
      removeSubscriber(dmSubscribers.get(auth.agentId), res);
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, HOST, () => {
  console.log(`Gateway running on http://${HOST}:${PORT}`);
  console.log(`Secret auth enabled. Set GATEWAY_SECRET to override.`);
});
