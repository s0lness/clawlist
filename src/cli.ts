import fs from "fs";
import { startAgent } from "./agent";
import { AgentConfig } from "./types";
import { loadConfig, saveConfig } from "./config";
import { getClient, ensureJoined, normalizeAlias } from "./matrix";
import { logEvent } from "./log";

function getArg(args: string[], name: string): string | null {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

function readEvents(logPath: string) {
  if (!fs.existsSync(logPath)) {
    throw new Error(`Log not found: ${logPath}`);
  }
  const raw = fs.readFileSync(logPath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (cmd === "agent") {
    const config = getArg(args, "config");
    if (!config) throw new Error("--config is required");
    startAgent(config);
    return;
  }

  if (cmd === "setup") {
    const configAPath = getArg(args, "config-a");
    const configBPath = getArg(args, "config-b");
    if (!configAPath || !configBPath) {
      throw new Error("--config-a and --config-b are required");
    }
    const { client, config: configA } = await getClient(configAPath);
    const configB = loadConfig(configBPath);

    const alias = normalizeAlias(configA.gossip_room_alias) ?? "#gossip:localhost";
    const aliasLocalpart = alias.split(":")[0].replace(/^#/, "");

    const gossipRoom = await client.createRoom({
      room_alias_name: aliasLocalpart,
      name: "gossip",
      visibility: "public",
      preset: "public_chat",
    });

    await client.invite(gossipRoom.room_id, configB.user_id);

    const dmRoom = await client.createRoom({
      is_direct: true,
      invite: [configB.user_id],
    });

    configA.gossip_room_id = gossipRoom.room_id;
    configB.gossip_room_id = gossipRoom.room_id;
    configA.dm_room_id = dmRoom.room_id;
    configB.dm_room_id = dmRoom.room_id;

    saveConfig(configAPath, configA);
    saveConfig(configBPath, configB);

    console.log("Setup complete");
    console.log(`gossip_room_id: ${gossipRoom.room_id}`);
    console.log(`dm_room_id: ${dmRoom.room_id}`);
    return;
  }

  if (cmd === "send") {
    const configPath = getArg(args, "config");
    const channel = getArg(args, "channel");
    const body = getArg(args, "body");

    if (!channel || !body) {
      throw new Error("--channel and --body are required");
    }
    if (channel !== "gossip" && channel !== "dm") {
      throw new Error("--channel must be gossip or dm");
    }

    if (!configPath) throw new Error("--config is required");
    const { client, config } = await getClient(configPath);
    const roomId =
      channel === "gossip" ? config.gossip_room_id : channel === "dm" ? config.dm_room_id : null;
    if (!roomId) throw new Error(`room id missing for ${channel}`);

    await ensureJoined(client, roomId);
    await client.sendEvent(
      roomId,
      "m.room.message",
      { msgtype: "m.text", body },
      ""
    );

    const channelKey = channel === "gossip" ? "gossip" : "dm";
    logEvent(
      {
        ts: new Date().toISOString(),
        channel: channelKey,
        from: config.user_id,
        body,
        transport: "matrix",
      },
      config.log_dir ?? "logs"
    );
    return;
  }

  if (cmd === "events") {
    const logPath = getArg(args, "log") ?? "logs/events.jsonl";
    const channel = getArg(args, "channel");
    const from = getArg(args, "from");
    const to = getArg(args, "to");
    const contains = getArg(args, "contains");
    const limitRaw = getArg(args, "limit");
    const limit = limitRaw ? Number(limitRaw) : 50;
    if (limitRaw && !Number.isFinite(limit)) throw new Error("--limit must be a number");

    let events = readEvents(logPath);
    if (channel) events = events.filter((e) => e.channel === channel);
    if (from) events = events.filter((e) => e.from === from);
    if (to) events = events.filter((e) => e.to === to);
    if (contains) events = events.filter((e) => String(e.body || "").includes(contains));

    const slice = events.slice(Math.max(0, events.length - limit));
    slice.forEach((e) => console.log(JSON.stringify(e)));
    return;
  }

  throw new Error("Command required: agent | setup | send | events");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
