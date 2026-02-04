const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "ui");
const LOG_DIR = path.join(__dirname, "..", "logs");
const PORT = Number(process.env.UI_PORT || 8090);
const HOST = process.env.UI_HOST || "127.0.0.1";
const RESET_DEMO_DELAY_MS = 800;

function ensureLogs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const gossip = path.join(LOG_DIR, "gossip.log");
  const dm = path.join(LOG_DIR, "dm.log");
  if (!fs.existsSync(gossip)) fs.writeFileSync(gossip, "", "utf8");
  if (!fs.existsSync(dm)) fs.writeFileSync(dm, "", "utf8");
}

function readLog(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readJsonLines(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function parseMatrixDmMatches(lines) {
  const matches = [];
  for (const line of lines.split(/\r?\n/)) {
    if (!line || !line.includes("MATCH_FOUND")) continue;
    const first = line.indexOf(" ");
    const second = line.indexOf(" ", first + 1);
    const third = line.indexOf(" ", second + 1);
    if (first === -1 || second === -1 || third === -1) continue;
    const ts = line.slice(0, first);
    const sender = line.slice(first + 1, second);
    const body = line.slice(third + 1);
    matches.push({ ts, sender, body, source: "matrix" });
  }
  return matches;
}

function parseGatewayDmMatches(lines) {
  const matches = [];
  for (const line of lines.split(/\r?\n/)) {
    if (!line || !line.includes("MATCH_FOUND")) continue;
    const first = line.indexOf(" ");
    if (first === -1) continue;
    const ts = line.slice(0, first);
    const rest = line.slice(first + 1);
    const arrowIdx = rest.indexOf(" -> ");
    if (arrowIdx === -1) continue;
    const sender = rest.slice(0, arrowIdx).trim();
    const rest2 = rest.slice(arrowIdx + 4);
    const second = rest2.indexOf(" ");
    if (second === -1) continue;
    const body = rest2.slice(second + 1);
    matches.push({ ts, sender, body, source: "gateway" });
  }
  return matches;
}

ensureLogs();

function handler(req, res) {
  if (req.url === "/" || req.url === "/index.html") {
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.url === "/logs") {
    const gossip = readLog(path.join(LOG_DIR, "gossip.log"));
    const dm = readLog(path.join(LOG_DIR, "dm.log"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ gossip, dm }));
    return;
  }

  if (req.url === "/roles") {
    const roles = readJson(path.join(LOG_DIR, "roles.json"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(roles || {}));
    return;
  }

  if (req.url === "/listings") {
    const listings = readJsonLines(path.join(LOG_DIR, "listings.jsonl"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ listings }));
    return;
  }

  if (req.url === "/approvals") {
    const approvals = readJsonLines(path.join(LOG_DIR, "approvals.jsonl"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ approvals }));
    return;
  }

  if (req.url === "/deals") {
    const deals = readJsonLines(path.join(LOG_DIR, "deals.jsonl"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ deals }));
    return;
  }

  if (req.url === "/matches") {
    const matrixDm = readLog(path.join(LOG_DIR, "dm.log"));
    const gatewayDm = readLog(path.join(LOG_DIR, "gateway-dm.log"));
    const matches = [
      ...parseMatrixDmMatches(matrixDm),
      ...parseGatewayDmMatches(gatewayDm),
    ].sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ matches }));
    return;
  }

  if (req.url === "/styles.css") {
    const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
    res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    res.end(css);
    return;
  }

  if (req.url === "/reset" && req.method === "POST") {
    try {
      fs.writeFileSync(path.join(LOG_DIR, "gossip.log"), "", "utf8");
      fs.writeFileSync(path.join(LOG_DIR, "dm.log"), "", "utf8");
    } catch {}

    setTimeout(() => {
      const { spawn } = require("child_process");
      const child = spawn("npm", ["run", "demo:docker"], {
        cwd: path.join(__dirname, ".."),
        stdio: "ignore",
        detached: true,
      });
      child.unref();
    }, RESET_DEMO_DELAY_MS);

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
}

const MAX_PORT = Number(process.env.UI_PORT_MAX || 8100);

function listenWithFallback(port) {
  const server = http.createServer(handler);
  server.on("error", (err) => {
    if ((err.code === "EADDRINUSE" || err.code === "EACCES") && port < MAX_PORT) {
      console.warn(`UI port ${port} unavailable (${err.code}), trying ${port + 1}...`);
      listenWithFallback(port + 1);
      return;
    }
    console.error("UI failed to start:", err);
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    console.log(`UI running at http://${HOST}:${port}`);
  });
}

listenWithFallback(PORT);
