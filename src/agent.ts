import fs from "fs";
import path from "path";
import sdk from "matrix-js-sdk";
import { spawn } from "child_process";

// Polyfill for older Node runtimes that lack Promise.withResolvers
if (!(Promise as any).withResolvers) {
  (Promise as any).withResolvers = function () {
    let resolve: (value: unknown) => void;
    let reject: (reason?: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve: resolve!, reject: reject! };
  };
}

type AgentConfig = {
  baseUrl: string;
  userId: string;
  password: string;
  deviceId?: string;
  accessToken?: string;
  gossipRoomAlias?: string;
  gossipRoomId?: string;
  dmRoomId?: string;
  logDir: string;
  promptPath?: string;
  openclawCmd?: string;
};

type Command = "send" | "setup" | "scripted" | "auth" | "bridge" | "intake" | "approve" | "gateway";
function getArg(args: string[], name: string): string | null {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

function loadConfig(configPath: string): AgentConfig {
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw) as AgentConfig;
}

function saveConfig(configPath: string, config: AgentConfig): void {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function getClient(configPath: string) {
  const config = loadConfig(configPath);

  if (config.accessToken) {
    const client: any = sdk.createClient({
      baseUrl: config.baseUrl,
      accessToken: config.accessToken,
      userId: config.userId,
      deviceId: config.deviceId,
    });
    return { client, config };
  }

  const baseClient: any = sdk.createClient({ baseUrl: config.baseUrl });
  const loginRes = await baseClient.login("m.login.password", {
    user: config.userId,
    password: config.password,
    device_id: config.deviceId,
  });

  config.accessToken = loginRes.access_token;
  config.userId = loginRes.user_id;
  config.deviceId = loginRes.device_id;
  saveConfig(configPath, config);

  const client: any = sdk.createClient({
    baseUrl: config.baseUrl,
    accessToken: loginRes.access_token,
    userId: loginRes.user_id,
    deviceId: loginRes.device_id,
  });

  return { client, config };
}

function ensureLogDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function appendLog(logPath: string, line: string) {
  fs.appendFileSync(logPath, line);
}

function appendJsonLine(logPath: string, obj: Record<string, unknown>) {
  fs.appendFileSync(logPath, JSON.stringify(obj) + "\n");
}

function httpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "https:" ? require("https") : require("http");
    const req = client.request(
      {
        method,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        headers,
      },
      (res: any) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString("utf8");
        });
        res.on("end", () => {
          resolve({ status: res.statusCode || 0, text: data });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function startSse(
  url: string,
  headers: Record<string, string>,
  onEvent: (event: string, data: any) => void
) {
  const target = new URL(url);
  const client = target.protocol === "https:" ? require("https") : require("http");
  const req = client.request(
    {
      method: "GET",
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      headers,
    },
    (res: any) => {
      res.setEncoding("utf8");
      let buffer = "";
      res.on("data", (chunk: string) => {
        buffer += chunk;
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = raw.split(/\r?\n/);
          let eventName = "message";
          let dataLine = "";
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventName = line.slice("event:".length).trim();
            } else if (line.startsWith("data:")) {
              dataLine += line.slice("data:".length).trim();
            }
          }
          if (!dataLine) continue;
          try {
            const payload = JSON.parse(dataLine);
            onEvent(eventName, payload);
          } catch (_err) {
            // Ignore malformed events.
          }
        }
      });
    }
  );
  req.on("error", () => {});
  req.end();
}

function parseListingMessage(body: string): { type: string; data: any } | null {
  const trimmed = body.trim();
  const prefixes = ["INTENT ", "LISTING_CREATE "];
  const prefix = prefixes.find((p) => trimmed.startsWith(p));
  if (!prefix) return null;
  const raw = trimmed.slice(prefix.length).trim();
  if (!raw) return null;
  const data = JSON.parse(raw);
  const type = prefix.startsWith("INTENT") ? "INTENT" : "LISTING_CREATE";
  return { type, data };
}

function buildListingFromAnswers(
  type: "buy" | "sell",
  item: string,
  price: number,
  currency: string,
  condition: string,
  ship: string,
  location: string,
  notes: string
) {
  const id = `lst_${type}_${Date.now()}`;
  return {
    id,
    type,
    item,
    price,
    currency,
    condition,
    ship,
    location,
    notes,
  };
}

function parseApprovalMessage(body: string): { type: "APPROVAL_REQUEST" | "APPROVAL_RESPONSE"; reason: string } | null {
  const trimmed = body.trim();
  if (trimmed.startsWith("APPROVAL_REQUEST")) {
    return { type: "APPROVAL_REQUEST", reason: trimmed.slice("APPROVAL_REQUEST".length).trim() };
  }
  if (trimmed.startsWith("APPROVAL_RESPONSE")) {
    return { type: "APPROVAL_RESPONSE", reason: trimmed.slice("APPROVAL_RESPONSE".length).trim() };
  }
  return null;
}

function parseDealMessage(body: string): { type: "DEAL_SUMMARY" | "CONFIRMED"; text: string } | null {
  const trimmed = body.trim();
  if (trimmed.startsWith("Deal Summary:") || trimmed.startsWith("DEAL_SUMMARY")) {
    return { type: "DEAL_SUMMARY", text: trimmed };
  }
  if (trimmed === "Confirmed" || trimmed === "CONFIRMED") {
    return { type: "CONFIRMED", text: trimmed };
  }
  return null;
}

function logListingIfPresent(
  logDir: string,
  payload: { body: string; ts: string; sender: string; roomId: string; direction: "in" | "out" }
) {
  try {
    const parsed = parseListingMessage(payload.body);
    if (!parsed) return;
    const listingLog = path.join(logDir, "listings.jsonl");
    appendJsonLine(listingLog, {
      ts: payload.ts,
      direction: payload.direction,
      sender: payload.sender,
      roomId: payload.roomId,
      type: parsed.type,
      data: parsed.data,
      raw: payload.body,
    });
  } catch (err: any) {
    const listingLog = path.join(logDir, "listings.jsonl");
    appendJsonLine(listingLog, {
      ts: payload.ts,
      direction: payload.direction,
      sender: payload.sender,
      roomId: payload.roomId,
      type: "INTENT",
      error: String(err?.message ?? err),
      raw: payload.body,
    });
  }
}

function logApprovalIfPresent(
  logDir: string,
  payload: { body: string; ts: string; sender: string; roomId: string; direction: "in" | "out" }
) {
  const parsed = parseApprovalMessage(payload.body);
  if (!parsed) return;
  const approvalsLog = path.join(logDir, "approvals.jsonl");
  appendJsonLine(approvalsLog, {
    ts: payload.ts,
    direction: payload.direction,
    sender: payload.sender,
    roomId: payload.roomId,
    type: parsed.type,
    reason: parsed.reason,
    raw: payload.body,
  });
}

function logDealIfPresent(
  logDir: string,
  payload: { body: string; ts: string; sender: string; roomId: string; direction: "in" | "out" }
) {
  const parsed = parseDealMessage(payload.body);
  if (!parsed) return;
  const dealsLog = path.join(logDir, "deals.jsonl");
  appendJsonLine(dealsLog, {
    ts: payload.ts,
    direction: payload.direction,
    sender: payload.sender,
    roomId: payload.roomId,
    type: parsed.type,
    text: parsed.text,
    raw: payload.body,
  });
}

async function runIntake(
  configPath: string,
  roomKey: "gossip" | "dm",
  type: "buy" | "sell",
  item: string,
  price: number,
  currency: string
) {
  const { config } = await getClient(configPath);
  ensureLogDir(config.logDir);

  const questions = [
    "What condition should it be in? (e.g., good, like new)",
    "What should be included (accessories/box/charger)?",
    "Location and shipping preference?",
    "Any extra notes or must-haves?",
  ];

  const answers: string[] = [];
  for (const q of questions) {
    process.stdout.write(`${q}\n> `);
    const answer = await new Promise<string>((resolve) => {
      process.stdin.once("data", (data) => resolve(String(data).trim()));
    });
    if (answer) answers.push(answer);
  }

  const condition = answers[0] || "good";
  const ship = answers[2] || "included";
  const location = answers[2] || "unspecified";
  const notes = answers[3] || answers[1] || "";
  const listing = buildListingFromAnswers(
    type,
    item,
    price,
    currency,
    condition,
    ship,
    location,
    notes
  );
  const text = `INTENT ${JSON.stringify(listing)}`;
  await sendMessage(configPath, roomKey, text);
}

async function sendApproval(
  configPath: string,
  roomKey: "gossip" | "dm",
  decision: "approve" | "decline",
  note?: string
) {
  const reason = note ? ` ${note}` : "";
  const text = `APPROVAL_RESPONSE ${decision}${reason}`;
  await sendMessage(configPath, roomKey, text);
}

async function sendMessage(configPath: string, roomKey: string, text: string) {
  const { client, config } = await getClient(configPath);
  ensureLogDir(config.logDir);

  let roomId = "";
  if (roomKey === "gossip") {
    roomId = config.gossipRoomId ?? "";
    if (!roomId && config.gossipRoomAlias) {
      const joined = await client.joinRoom(config.gossipRoomAlias);
      roomId = typeof joined === "string" ? joined : joined.roomId;
    }
  } else if (roomKey === "dm") {
    roomId = config.dmRoomId ?? "";
  }

  if (!roomId) {
    throw new Error(`Room not configured for ${roomKey}`);
  }

  if (roomKey === "dm") {
    await client.joinRoom(roomId);
  }

  await client.sendEvent(
    roomId,
    "m.room.message",
    { msgtype: "m.text", body: text },
    ""
  );
  const ts = new Date().toISOString();
  const logPath = path.join(
    config.logDir,
    roomKey === "gossip" ? "gossip.log" : "dm.log"
  );
  appendLog(logPath, `${ts} ${config.userId} ${roomId} ${text}\n`);
  logListingIfPresent(config.logDir, {
    body: text,
    ts,
    sender: config.userId,
    roomId,
    direction: "out",
  });
  logApprovalIfPresent(config.logDir, {
    body: text,
    ts,
    sender: config.userId,
    roomId,
    direction: "out",
  });
  logDealIfPresent(config.logDir, {
    body: text,
    ts,
    sender: config.userId,
    roomId,
    direction: "out",
  });
  console.log(`Sent to ${roomKey}: ${text}`);
}

async function setupRooms(configPathA: string, configPathB: string) {
  const { client, config: configA } = await getClient(configPathA);
  const configB = loadConfig(configPathB);

  const alias = configA.gossipRoomAlias ?? "#gossip:localhost";
  const aliasLocalpart = alias.split(":")[0].replace(/^#/, "");

  const gossipRoom = await client.createRoom({
    room_alias_name: aliasLocalpart,
    name: "gossip",
    visibility: "public",
    preset: "public_chat",
  });

  await client.invite(gossipRoom.room_id, configB.userId);

  const dmRoom = await client.createRoom({
    is_direct: true,
    invite: [configB.userId],
  });

  configA.gossipRoomId = gossipRoom.room_id;
  configB.gossipRoomId = gossipRoom.room_id;
  configA.dmRoomId = dmRoom.room_id;
  configB.dmRoomId = dmRoom.room_id;

  saveConfig(configPathA, configA);
  saveConfig(configPathB, configB);

  console.log("Setup complete");
  console.log(`gossipRoomId: ${gossipRoom.room_id}`);
  console.log(`dmRoomId: ${dmRoom.room_id}`);
}

async function scriptedSend(configPath: string, roomKey: string, scriptPath: string) {
  const { client, config } = await getClient(configPath);
  ensureLogDir(config.logDir);

  let roomId = "";
  if (roomKey === "gossip") {
    roomId = config.gossipRoomId ?? "";
    if (!roomId && config.gossipRoomAlias) {
      const joined = await client.joinRoom(config.gossipRoomAlias);
      roomId = typeof joined === "string" ? joined : joined.roomId;
    }
  } else if (roomKey === "dm") {
    roomId = config.dmRoomId ?? "";
  }

  if (!roomId) {
    throw new Error(`Room not configured for ${roomKey}`);
  }

  if (roomKey === "dm") {
    await client.joinRoom(roomId);
  }

  const raw = fs.readFileSync(scriptPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const logPath =
    roomKey === "gossip"
      ? path.join(config.logDir, "gossip.log")
      : path.join(config.logDir, "dm.log");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("sleep ")) {
      const ms = Number(trimmed.replace("sleep ", "").trim());
      if (!Number.isFinite(ms) || ms < 0) {
        throw new Error(`Invalid sleep duration: ${trimmed}`);
      }
      await new Promise((resolve) => setTimeout(resolve, ms));
      continue;
    }

    await client.sendEvent(
      roomId,
      "m.room.message",
      { msgtype: "m.text", body: trimmed },
      ""
    );
    const ts = new Date().toISOString();
    const sender = config.userId;
    appendLog(logPath, `${ts} ${sender} ${roomId} ${trimmed}\n`);
    logListingIfPresent(config.logDir, {
      body: trimmed,
      ts,
      sender,
      roomId,
      direction: "out",
    });
    logApprovalIfPresent(config.logDir, {
      body: trimmed,
      ts,
      sender,
      roomId,
      direction: "out",
    });
    logDealIfPresent(config.logDir, {
      body: trimmed,
      ts,
      sender,
      roomId,
      direction: "out",
    });
    console.log(`Sent: ${trimmed}`);
  }
}

async function runBridge(
  configPath: string,
  sessionId: string,
  roomMode: "gossip" | "dm" | "both" = "both"
) {
  const { client, config } = await getClient(configPath);
  ensureLogDir(config.logDir);
  const openclawCmd = config.openclawCmd ?? process.env.OPENCLAW_CMD ?? "openclaw";
  const startTs = Date.now() - 1000;
  let gossipRoomId = config.gossipRoomId ?? "";
  let dmRoomId = config.dmRoomId ?? "";

  const debug = process.env.BRIDGE_DEBUG === "1";
  let busy = false;

  client.on("Room.timeline", async (event: any, room: any, toStartOfTimeline: boolean) => {
    if (toStartOfTimeline) return;
    if (event.getTs && event.getTs() < startTs) return;
    if (event.getType() !== "m.room.message") return;
    const content = event.getContent();
    if (!content || content.msgtype !== "m.text") return;

    const body = String(content.body ?? "");
    const sender = String(event.getSender() ?? "unknown");
    const roomId = String(room?.roomId ?? "unknown");
    const ts = new Date(event.getTs ? event.getTs() : Date.now()).toISOString();

    const isSelf = sender === config.userId;
    if (isSelf) {
      return;
    }
    const isGossip = roomId === gossipRoomId;
    const isDm = roomId === dmRoomId;
    if (!isGossip && !isDm) return;
    if (debug) {
      console.log(`[bridge] message room=${roomId} sender=${sender} gossip=${isGossip} dm=${isDm} body="${body}"`);
    }
    if (
      roomMode !== "both" &&
      ((roomMode === "gossip" && !isGossip) || (roomMode === "dm" && !isDm))
    ) {
      return;
    }
    if (busy) return;

    logListingIfPresent(config.logDir, {
      body,
      ts,
      sender,
      roomId,
      direction: "in",
    });
    logApprovalIfPresent(config.logDir, {
      body,
      ts,
      sender,
      roomId,
      direction: "in",
    });
    logDealIfPresent(config.logDir, {
      body,
      ts,
      sender,
      roomId,
      direction: "in",
    });

    busy = true;
    const prompt = `${isGossip ? "GOSSIP" : "DM"} MESSAGE from ${sender}: ${body}\nReply with exactly one line:\n- DM: <message>\n- GOSSIP: <message>\n- SKIP`;

    try {
      const reply = await new Promise<string>((resolve, reject) => {
        const args = ["agent"];
        if (sessionId) {
          args.push("--session-id", sessionId);
        }
        args.push("--message", prompt);
        const child = spawn(openclawCmd, args, {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        let errOut = "";
        child.stdout.on("data", (chunk) => {
          output += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
          errOut += chunk.toString("utf8");
        });
        child.on("exit", (code) => {
          if (code === 0) {
            const lines = output
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean);
            resolve(lines[lines.length - 1] ?? "");
          } else {
            reject(new Error(`openclaw agent exited with code ${code ?? "unknown"}: ${errOut}`));
          }
        });
      });

      if (debug) {
        console.log(`[bridge] reply="${reply}"`);
      }
      if (!reply || reply.toUpperCase() === "SKIP") return;

      const prefix = reply.split(":")[0]?.toUpperCase();
      const message = reply.includes(":") ? reply.slice(reply.indexOf(":") + 1).trim() : "";
      if (!message) return;

      if (prefix === "GOSSIP") {
        if (!gossipRoomId) return;
        await client.sendEvent(
          gossipRoomId,
          "m.room.message",
          { msgtype: "m.text", body: message },
          ""
        );
        const ts = new Date().toISOString();
        appendLog(path.join(config.logDir, "gossip.log"), `${ts} ${config.userId} ${gossipRoomId} ${message}\n`);
        if (debug) console.log(`[bridge] sent gossip="${message}"`);
      } else if (prefix === "DM") {
        if (!dmRoomId) return;
        await client.joinRoom(dmRoomId);
        await client.sendEvent(
          dmRoomId,
          "m.room.message",
          { msgtype: "m.text", body: message },
          ""
        );
        const ts = new Date().toISOString();
        appendLog(path.join(config.logDir, "dm.log"), `${ts} ${config.userId} ${dmRoomId} ${message}\n`);
        logApprovalIfPresent(config.logDir, {
          body: message,
          ts,
          sender: config.userId,
          roomId: dmRoomId,
          direction: "out",
        });
        logDealIfPresent(config.logDir, {
          body: message,
          ts,
          sender: config.userId,
          roomId: dmRoomId,
          direction: "out",
        });
        if (debug) console.log(`[bridge] sent dm="${message}"`);
      }
    } catch (err) {
      console.error("OpenClaw bridge failed:", err);
    } finally {
      busy = false;
    }
  });

  client.on("sync", async (state: string) => {
    if (state !== "PREPARED") return;

    if (config.gossipRoomAlias && !gossipRoomId) {
      const joined = await client.joinRoom(config.gossipRoomAlias);
      gossipRoomId = typeof joined === "string" ? joined : joined.roomId;
    } else if (gossipRoomId) {
      await client.joinRoom(gossipRoomId);
    }

    if (dmRoomId) {
      await client.joinRoom(dmRoomId);
    }
  });

  client.startClient({ initialSyncLimit: 0 });
  console.log(
    `Bridge running for ${config.userId} -> OpenClaw session ${sessionId} (rooms: ${roomMode})`
  );
}

async function runGatewayBridge(
  gatewayUrl: string,
  accessToken: string,
  agentId: string,
  sessionId: string
) {
  const openclawCmd = process.env.OPENCLAW_CMD ?? "openclaw";
  const logDir = process.env.GATEWAY_LOG_DIR ?? "logs";
  ensureLogDir(logDir);

  const gossipStream = new URL("/gossip/stream", gatewayUrl).toString();
  const dmStream = new URL("/dm/stream", gatewayUrl).toString();
  const gossipPost = new URL("/gossip", gatewayUrl).toString();
  const dmPost = new URL("/dm", gatewayUrl).toString();

  const headers = { Authorization: `Bearer ${accessToken}` };
  let busy = false;

  function handleInbound(kind: "gossip" | "dm", payload: any) {
    if (payload?.agent_id && payload.agent_id === agentId) return;
    if (payload?.from_agent && payload.from_agent === agentId) return;
    if (busy) return;
    const sender = payload?.agent_id || payload?.from_agent || "unknown";
    const body = String(payload?.body || "");

    busy = true;
    const prompt = `${kind.toUpperCase()} MESSAGE from ${sender}: ${body}\nReply with exactly one line:\n- DM: <agent_id> <message>\n- GOSSIP: <message>\n- SKIP`;

    const reply = new Promise<string>((resolve, reject) => {
      const args = ["agent", "--message", prompt];
      if (sessionId) args.splice(1, 0, "--session-id", sessionId);
      const child = spawn(openclawCmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      let errOut = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        errOut += chunk.toString("utf8");
      });
      child.on("exit", (code) => {
        if (code === 0) {
          const lines = output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
          resolve(lines[lines.length - 1] ?? "");
        } else {
          reject(new Error(`openclaw agent exited with code ${code ?? "unknown"}: ${errOut}`));
        }
      });
    });

    reply
      .then(async (line) => {
        if (!line || line.toUpperCase() === "SKIP") return;
        const prefix = line.split(":")[0]?.toUpperCase();
        const message = line.includes(":") ? line.slice(line.indexOf(":") + 1).trim() : "";
        if (!message) return;

        if (prefix === "GOSSIP") {
          await httpRequest(
            gossipPost,
            "POST",
            { ...headers, "Content-Type": "application/json" },
            JSON.stringify({ body: message })
          );
          appendLog(path.join(logDir, "gateway-bridge.log"), `${new Date().toISOString()} OUT GOSSIP ${message}\n`);
        } else if (prefix === "DM") {
          const [toAgent, ...rest] = message.split(" ");
          const dmBody = rest.join(" ").trim();
          if (!toAgent || !dmBody) return;
          await httpRequest(
            dmPost,
            "POST",
            { ...headers, "Content-Type": "application/json" },
            JSON.stringify({ to_agent: toAgent, body: dmBody })
          );
          appendLog(
            path.join(logDir, "gateway-bridge.log"),
            `${new Date().toISOString()} OUT DM to=${toAgent} ${dmBody}\n`
          );
        }
      })
      .catch((err) => {
        console.error("Gateway bridge failed:", err);
      })
      .finally(() => {
        busy = false;
      });
  }

  startSse(gossipStream, headers, (event, payload) => {
    if (event === "gossip") handleInbound("gossip", payload);
  });
  startSse(dmStream, headers, (event, payload) => {
    if (event === "dm") handleInbound("dm", payload);
  });

  console.log(
    `Gateway bridge running (agent=${agentId}) -> OpenClaw session ${sessionId} @ ${gatewayUrl}`
  );
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] as Command | undefined;
  if (!cmd) {
    throw new Error("Command required: send | setup | scripted | auth | bridge | gateway");
  }

  if (cmd === "send") {
    const configPath = getArg(args, "config");
    const room = getArg(args, "room");
    const text = getArg(args, "text");
    if (!configPath || !room || !text) {
      throw new Error("--config, --room, and --text are required");
    }
    await sendMessage(configPath, room, text);
    return;
  }

  if (cmd === "setup") {
    const configA = getArg(args, "config-a");
    const configB = getArg(args, "config-b");
    if (!configA || !configB) {
      throw new Error("--config-a and --config-b are required");
    }
    await setupRooms(configA, configB);
    return;
  }

  if (cmd === "scripted") {
    const configPath = getArg(args, "config");
    const room = getArg(args, "room");
    const script = getArg(args, "script");
    if (!configPath || !room || !script) {
      throw new Error("--config, --room, and --script are required");
    }
    await scriptedSend(configPath, room, script);
    return;
  }

  if (cmd === "auth") {
    const configPath = getArg(args, "config");
    if (!configPath) throw new Error("--config is required");
    await getClient(configPath);
    console.log("Auth complete");
    return;
  }

  if (cmd === "bridge") {
    const configPath = getArg(args, "config");
    const sessionId = getArg(args, "session");
    const room = (getArg(args, "room") ?? "both") as "gossip" | "dm" | "both";
    if (!configPath || !sessionId) {
      throw new Error("--config and --session are required");
    }
    await runBridge(
      configPath,
      sessionId,
      room
    );
    return;
  }

  if (cmd === "intake") {
    const configPath = getArg(args, "config");
    const room = (getArg(args, "room") ?? "gossip") as "gossip" | "dm";
    const type = (getArg(args, "type") ?? "buy") as "buy" | "sell";
    const item = getArg(args, "item");
    const priceRaw = getArg(args, "price");
    const currency = getArg(args, "currency") ?? "EUR";
    if (!configPath || !item || !priceRaw) {
      throw new Error("--config, --item, and --price are required");
    }
    const price = Number(priceRaw);
    if (!Number.isFinite(price)) {
      throw new Error("--price must be a number");
    }
    await runIntake(configPath, room, type, item, price, currency);
    return;
  }

  if (cmd === "approve") {
    const configPath = getArg(args, "config");
    const room = (getArg(args, "room") ?? "dm") as "gossip" | "dm";
    const decision = (getArg(args, "decision") ?? "approve") as "approve" | "decline";
    const note = getArg(args, "note") ?? undefined;
    if (!configPath) {
      throw new Error("--config is required");
    }
    if (decision !== "approve" && decision !== "decline") {
      throw new Error("--decision must be approve or decline");
    }
    await sendApproval(configPath, room, decision, note);
    return;
  }

  if (cmd === "gateway") {
    const url = getArg(args, "url");
    const token = getArg(args, "token");
    const agentId = getArg(args, "agent-id");
    const sessionId = getArg(args, "session") ?? "gateway-bridge";
    if (!url || !token || !agentId) {
      throw new Error("gateway requires --url, --token, and --agent-id");
    }
    await runGatewayBridge(url, token, agentId, sessionId);
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
