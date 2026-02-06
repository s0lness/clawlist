import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] || 'out';
const metaPath = process.argv[3] || path.join(outDir, 'meta.json');
const secretsPath = process.argv[4] || path.join(outDir, 'secrets.env');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

function parseEnvFile(p) {
  if (!fs.existsSync(p)) return {};
  const txt = fs.readFileSync(p, 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2];
  }
  return out;
}

const secrets = parseEnvFile(secretsPath);

const HS = meta.homeserver;
const marketRoomId = meta.marketRoomId;
const sellerToken = meta.sellerToken || secrets.SELLER_TOKEN;
const buyerToken = meta.buyerToken || secrets.BUYER_TOKEN;

async function httpJson(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...headers,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${url} -> ${res.status} ${res.statusText}\n${text}`);
  }
  return res.json();
}

async function listJoinedRooms(token) {
  const j = await httpJson(`${HS}/_matrix/client/v3/joined_rooms`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return j.joined_rooms || [];
}

async function findDmRoomId() {
  // Prefer explicit DM room id from meta when provided (deterministic).
  if (meta.dmRoomId) return meta.dmRoomId;

  // Fallback heuristic: any joined room that isn't the market room and is shared by both users.
  const sellerRooms = new Set(await listJoinedRooms(sellerToken));
  const buyerRooms = new Set(await listJoinedRooms(buyerToken));

  const shared = [...sellerRooms].filter((r) => buyerRooms.has(r) && r !== marketRoomId);
  if (shared.length === 0) return null;
  return shared[0];
}

async function exportRoom(roomId, token, outFile) {
  const events = [];
  let from;

  // Pull up to ~1000 events in chunks (best effort)
  for (let i = 0; i < 10; i++) {
    const url = new URL(`${HS}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`);
    url.searchParams.set('dir', 'b');
    url.searchParams.set('limit', '100');
    if (from) url.searchParams.set('from', from);

    const j = await httpJson(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    const chunk = j.chunk || [];
    events.push(...chunk);

    if (!j.end || chunk.length === 0) break;
    from = j.end;
  }

  fs.writeFileSync(outFile, events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

async function main() {
  if (!HS || !marketRoomId || !sellerToken || !buyerToken) {
    die(
      `missing required fields: homeserver=${!!HS} marketRoomId=${!!marketRoomId} sellerToken=${!!sellerToken} buyerToken=${!!buyerToken}. ` +
        `Provide tokens via meta.json or secrets.env (arg4: ${secretsPath}).`
    );
  }

  fs.mkdirSync(outDir, { recursive: true });

  await exportRoom(marketRoomId, sellerToken, path.join(outDir, 'market.jsonl'));

  const dmRoomId = await findDmRoomId();
  if (dmRoomId) {
    await exportRoom(dmRoomId, sellerToken, path.join(outDir, 'dm.jsonl'));
    meta.dmRoomId = dmRoomId;
  } else {
    meta.dmRoomId = null;
  }

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  console.log(`[export] wrote ${path.join(outDir, 'market.jsonl')} and dm=${dmRoomId || 'none'}`);
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exit(1);
});
