// @ts-nocheck
import fs from "node:fs";
import { encodeMxid, fetchJson, fetchRetry, hasDockerContainer, run } from "./common";

const SELLER_USER = "switch_seller";
const BUYER_USER = "switch_buyer";
const SELLER_PASS = "SellerPass123!";
const BUYER_PASS = "BuyerPass123!";

async function matrixPostJson(url: string, payload: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchJson(url, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`request failed ${url} status=${res.status} body=${res.text}`);
  return res.json as any;
}

async function login(port: number, user: string, pass: string): Promise<string> {
  const url = `http://127.0.0.1:${port}/_matrix/client/v3/login`;
  const body = { type: "m.login.password", identifier: { type: "m.id.user", user }, password: pass };
  const json = await matrixPostJson(url, body);
  if (!json?.access_token) throw new Error(`missing access token for ${user}`);
  return json.access_token;
}

async function main() {
  const matrixPort = Number(process.env.MATRIX_PORT || 18008);

  try {
    await fetchRetry(`http://127.0.0.1:${matrixPort}/_matrix/client/versions`, {}, 1);
  } catch {
    throw new Error(`[bootstrap_session] synapse not reachable on port ${matrixPort}. Run matrix-up first.`);
  }

  if (!hasDockerContainer("clawlist-synapse")) {
    throw new Error("[bootstrap_session] clawlist-synapse container not running");
  }

  run("docker", [
    "exec", "clawlist-synapse", "register_new_matrix_user", "-c", "/data/homeserver.yaml",
    "http://127.0.0.1:8008", "-u", SELLER_USER, "-p", SELLER_PASS, "--no-admin",
  ], { allowFail: true, stdio: "pipe", timeoutMs: 60000 });

  run("docker", [
    "exec", "clawlist-synapse", "register_new_matrix_user", "-c", "/data/homeserver.yaml",
    "http://127.0.0.1:8008", "-u", BUYER_USER, "-p", BUYER_PASS, "--no-admin",
  ], { allowFail: true, stdio: "pipe", timeoutMs: 60000 });

  const sellerToken = await login(matrixPort, SELLER_USER, SELLER_PASS);
  const buyerToken = await login(matrixPort, BUYER_USER, BUYER_PASS);

  const rulesAlias = process.env.RULES_ROOM_ALIAS || "#house-rules:localhost";
  const roomSuffix = process.env.MATRIX_RUN_ID || "";
  const roomAlias = roomSuffix ? `#market-${roomSuffix}:localhost` : "#market:localhost";
  const roomAliasName = roomSuffix ? `market-${roomSuffix}` : "market";

  async function ensureRoom(alias: string, aliasName: string, name: string, topic: string) {
    let roomId = "";
    try {
      const create = await matrixPostJson(
        `http://127.0.0.1:${matrixPort}/_matrix/client/v3/createRoom`,
        { preset: "public_chat", name, room_alias_name: aliasName, topic, visibility: "public" },
        sellerToken
      );
      roomId = create?.room_id || "";
    } catch {
      roomId = "";
    }

    if (!roomId) {
      const encodedAlias = encodeMxid(alias);
      const resolveRes = await fetchJson(`http://127.0.0.1:${matrixPort}/_matrix/client/v3/directory/room/${encodedAlias}`);
      roomId = (resolveRes.json as any)?.room_id || "";
    }

    if (!roomId) throw new Error(`[bootstrap_session] failed to create/resolve room alias=${alias}`);
    return roomId;
  }

  const rulesAliasName = rulesAlias.replace(/^#/, "").split(":")[0] || "house-rules";
  const rulesRoomId = await ensureRoom(rulesAlias, rulesAliasName, rulesAliasName, "clawlist house rules");

  const roomId = await ensureRoom(roomAlias, roomAliasName, roomAliasName, `clawlist market run ${roomSuffix}`);

  // (room ids already resolved by ensureRoom)

  const buyerMxid = `@${BUYER_USER}:localhost`;

  // Ensure both users join the rules room (best effort)
  await fetchJson(`http://127.0.0.1:${matrixPort}/_matrix/client/v3/rooms/${rulesRoomId}/invite`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: buyerMxid }),
  }).catch(() => undefined);

  await fetchJson(`http://127.0.0.1:${matrixPort}/_matrix/client/v3/rooms/${rulesRoomId}/join`, {
    method: "POST",
    headers: { Authorization: `Bearer ${buyerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }).catch(() => undefined);

  // Invite/join buyer to market room
  await fetchJson(`http://127.0.0.1:${matrixPort}/_matrix/client/v3/rooms/${roomId}/invite`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: buyerMxid }),
  }).catch(() => undefined);

  await fetchJson(`http://127.0.0.1:${matrixPort}/_matrix/client/v3/rooms/${roomId}/join`, {
    method: "POST",
    headers: { Authorization: `Bearer ${buyerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }).catch(() => undefined);

  // Post the current house rules (best effort)
  const rulesPath = process.env.HOUSE_RULES_PATH || "prompts/venues/market.md";
  let rulesText = "";
  try {
    rulesText = fs.readFileSync(rulesPath, "utf8").trim();
  } catch {
    rulesText = "Market House Rules: Use the public room to broadcast offers/requests; move to DM for negotiation and personal details; be concise; no spam.";
  }
  await fetchJson(`http://127.0.0.1:${matrixPort}/_matrix/client/v3/rooms/${rulesRoomId}/send/m.room.message/txn${Date.now()}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${sellerToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "m.text", body: rulesText }),
  }).catch(() => undefined);

  console.log(`ROOM_ID=${roomId}`);
  console.log(`ROOM_ALIAS=${roomAlias}`);
  console.log(`RULES_ROOM_ID=${rulesRoomId}`);
  console.log(`RULES_ROOM_ALIAS=${rulesAlias}`);
  console.log(`SELLER_MXID=@${SELLER_USER}:localhost`);
  console.log(`BUYER_MXID=@${BUYER_USER}:localhost`);

  const secretsFile = process.env.BOOTSTRAP_SECRETS_FILE;
  if (secretsFile) {
    fs.writeFileSync(secretsFile, `SELLER_TOKEN=${sellerToken}\nBUYER_TOKEN=${buyerToken}\n`, "utf8");
    fs.chmodSync(secretsFile, 0o600);
  }
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
