// @ts-nocheck
import fs from "node:fs";
import path from "node:path";

function usage() {
  console.log(`Usage:
  npm run matrix:watch -- --run-id <id>
  npm run matrix:watch -- --latest

Watches Matrix rooms for a run and prints new m.room.message events.
Uses runs/<id>/out/bootstrap.env + secrets.env.
`);
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const flags: Record<string, any> = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      flags[k] = true;
    } else {
      flags[k] = next;
      i += 1;
    }
  }
  return flags;
}

function readEnvFile(p: string) {
  const out: Record<string, string> = {};
  if (!fs.existsSync(p)) return out;
  const txt = fs.readFileSync(p, "utf8");
  for (const line of txt.split(/\r?\n/)) {
    if (!/^[A-Z0-9_]+=/.test(line)) continue;
    const idx = line.indexOf("=");
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function findLatestRunId(runsDir: string) {
  if (!fs.existsSync(runsDir)) return null;
  const entries = fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  return entries.length ? entries[entries.length - 1] : null;
}

function shortName(mxid: string) {
  if (!mxid) return "?";
  const m = mxid.match(/^@([^:]+):/);
  return m ? m[1] : mxid;
}

function fmtTime(ts?: number) {
  if (!ts || !Number.isFinite(ts)) return "--:--:--";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function wrap(text: string, width = 100) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (!line) {
      line = w;
      continue;
    }
    if (line.length + 1 + w.length <= width) {
      line += " " + w;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function color(s: string, code: string) {
  if (!process.stdout.isTTY) return s;
  return `\u001b[${code}m${s}\u001b[0m`;
}

function labelColor(label: string) {
  if (label === "market") return "36"; // cyan
  if (label === "dm") return "35"; // magenta
  if (label === "rules") return "33"; // yellow
  return "90"; // gray
}

async function syncLoop(
  hs: string,
  token: string,
  roomLabels: Map<string, string>,
  opts: { wrapWidth: number; verbose: boolean; history: boolean }
) {
  let since: string | undefined;
  const seenEventIds = new Set<string>();
  let isFirst = true;

  while (true) {
    const url = new URL(`${hs}/_matrix/client/v3/sync`);
    url.searchParams.set("timeout", "30000");
    if (since) url.searchParams.set("since", since);

    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`sync failed: ${res.status} ${res.statusText}\n${txt}`);
    }

    const j: any = await res.json();
    since = j.next_batch;

    // Default behavior: treat the first sync as catch-up and don't print it.
    // This avoids confusing output from old rooms/runs.
    if (isFirst && !opts.history) {
      isFirst = false;
      continue;
    }
    isFirst = false;

    const joins = j?.rooms?.join || {};
    for (const [roomId, data] of Object.entries<any>(joins)) {
      const timeline = data?.timeline?.events || [];

      // Only label unknown rooms as DM when they actually produce a message.
      let label = roomLabels.get(roomId);

      for (const ev of timeline) {
        if (!ev || ev.type !== "m.room.message") continue;

        if (!label) {
          label = "dm";
          roomLabels.set(roomId, label);
          if (opts.verbose) {
            console.log(color(`[watch] discovered room labeled dm: ${roomId}`, "90"));
          }
        }

        if (typeof ev.event_id === "string") {
          if (seenEventIds.has(ev.event_id)) continue;
          seenEventIds.add(ev.event_id);
        }

        const body = ev.content?.body;
        if (typeof body !== "string" || !body.trim()) continue;

        const ts = fmtTime(ev.origin_server_ts);
        const sender = shortName(ev.sender);
        const tag = color(label.padEnd(5), labelColor(label));

        const lines = wrap(body, opts.wrapWidth);
        const head = `${ts} [${tag}] ${color(sender, "1")}`;
        if (lines.length <= 1) {
          console.log(`${head}: ${lines[0] || ""}`);
        } else {
          console.log(`${head}:`);
          for (const l of lines) {
            console.log(`  ${l}`);
          }
        }
        console.log("");
      }
    }
  }
}

async function main() {
  const root = path.resolve(__dirname, "../..");
  const flags = parseArgs(process.argv);

  if (flags.help) {
    usage();
    process.exit(0);
  }

  const runsDir = path.join(root, "runs");
  const runId = flags["run-id"] || (flags.latest ? findLatestRunId(runsDir) : null);
  if (!runId) {
    usage();
    throw new Error("Missing --run-id (or use --latest)");
  }

  const outDir = path.join(runsDir, String(runId), "out");
  const envA = readEnvFile(path.join(outDir, "bootstrap.env"));
  const envB = readEnvFile(path.join(outDir, "secrets.env"));

  const hs = envA.HOMESERVER || "http://127.0.0.1:18008";
  const token = envB.SELLER_TOKEN || envB.BUYER_TOKEN;
  if (!token) throw new Error(`Missing SELLER_TOKEN/BUYER_TOKEN in ${path.join(outDir, "secrets.env")}`);

  const marketRoomId = envA.ROOM_ID;
  const rulesRoomId = envA.RULES_ROOM_ID;

  const roomLabels = new Map<string, string>();
  if (marketRoomId) roomLabels.set(marketRoomId, "market");
  if (rulesRoomId) roomLabels.set(rulesRoomId, "rules");

  const wrapWidth = Number(flags.wrap || 100);
  const verbose = !!flags.verbose;
  const history = !!flags.history;

  console.log(color(`watch: run=${runId} hs=${hs}`, "90"));
  console.log(color(`watch: out=${outDir}`, "90"));
  console.log(color(`watch: market=${marketRoomId || "?"} rules=${rulesRoomId || "?"} (others -> dm on first message)`, "90"));
  console.log(color(`watch: mode=${history ? "history" : "live"} (pass --history to include first sync catch-up)`, "90"));
  console.log("");

  await syncLoop(hs, token, roomLabels, { wrapWidth, verbose, history });
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
