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

function followEvents(logPath: string) {
  if (!fs.existsSync(logPath)) {
    throw new Error(`Log not found: ${logPath}`);
  }
  let position = fs.statSync(logPath).size;
  setInterval(() => {
    const stats = fs.statSync(logPath);
    if (stats.size <= position) return;
    const stream = fs.createReadStream(logPath, { start: position, end: stats.size });
    let data = "";
    stream.on("data", (chunk) => {
      data += chunk.toString("utf8");
    });
    stream.on("end", () => {
      position = stats.size;
      data
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => console.log(line));
    });
  }, 1000);
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  agent --config <path>",
      "  setup --config-a <path> --config-b <path>",
      "  send --config <path> --channel <gossip|dm> --body <text> [--to <user_id>]",
      "  events [--log <path>] [--channel gossip|dm] [--from <user>] [--to <user>] [--contains <text>] [--limit <n>] [--follow true|1]",
    ].join("\n")
  );
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
    const aliasDomain = alias.split(":")[1];
    const userDomain = configA.user_id.split(":")[1];
    if (aliasDomain && userDomain && aliasDomain !== userDomain) {
      throw new Error(
        `gossip_room_alias domain (${aliasDomain}) must match user_id domain (${userDomain})`
      );
    }
    const aliasLocalpart = alias.split(":")[0].replace(/^#/, "");
    const dmAlias = normalizeAlias(configA.dm_room_alias) ?? "#dm:localhost";
    const dmAliasDomain = dmAlias.split(":")[1];
    if (dmAliasDomain && userDomain && dmAliasDomain !== userDomain) {
      throw new Error(
        `dm_room_alias domain (${dmAliasDomain}) must match user_id domain (${userDomain})`
      );
    }
    const dmAliasLocalpart = dmAlias.split(":")[0].replace(/^#/, "");

    const gossipRoom = await client.createRoom({
      room_alias_name: aliasLocalpart,
      name: "gossip",
      visibility: "public",
      preset: "public_chat",
    });

    await client.invite(gossipRoom.room_id, configB.user_id);

    const dmRoom = await client.createRoom({
      room_alias_name: dmAliasLocalpart,
      name: "dm",
      is_direct: true,
      invite: [configB.user_id],
    });

    configA.gossip_room_id = gossipRoom.room_id;
    configB.gossip_room_id = gossipRoom.room_id;
    configA.dm_room_id = dmRoom.room_id;
    configB.dm_room_id = dmRoom.room_id;
    configA.dm_room_alias = dmAlias;
    configB.dm_room_alias = dmAlias;

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
    const toArg = getArg(args, "to");

    if (!channel || !body) {
      throw new Error("--channel and --body are required");
    }
    if (channel !== "gossip" && channel !== "dm") {
      throw new Error("--channel must be gossip or dm");
    }

    if (!configPath) throw new Error("--config is required");
    const { client, config } = await getClient(configPath);
    let roomId: string | null = null;
    let roomAlias: string | null = null;
    if (channel === "gossip") {
      roomId = config.gossip_room_id ?? null;
      roomAlias = config.gossip_room_alias ?? null;
    } else if (channel === "dm") {
      if (toArg && config.dm_rooms && config.dm_rooms[toArg]) {
        roomId = config.dm_rooms[toArg];
      } else if (toArg) {
        throw new Error(`dm room missing for recipient ${toArg}`);
      } else {
        roomId = config.dm_room_id ?? null;
        roomAlias = config.dm_room_alias ?? null;
      }
    }
    if (!roomId && roomAlias) {
      roomId = await ensureJoined(client, roomAlias);
    }
    if (!roomId) throw new Error(`room id missing for ${channel}`);

    await ensureJoined(client, roomId);
    const sendRes = await client.sendEvent(
      roomId,
      "m.room.message",
      { msgtype: "m.text", body },
      ""
    );
    const eventId =
      typeof sendRes === "string" ? sendRes : sendRes?.event_id ?? sendRes?.eventId;

    const channelKey = channel === "gossip" ? "gossip" : "dm";
    const to = channelKey === "dm" ? toArg ?? config.dm_recipient : undefined;
    logEvent(
      {
        ts: new Date().toISOString(),
        channel: channelKey,
        from: config.user_id,
        to,
        body,
        transport: "matrix",
        room_id: roomId,
        event_id: eventId,
      },
      config.log_dir ?? "logs",
      config.log_redact ?? "none"
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
    const follow = getArg(args, "follow") === "1" || getArg(args, "follow") === "true";

    let events = readEvents(logPath);
    if (channel) events = events.filter((e) => e.channel === channel);
    if (from) events = events.filter((e) => e.from === from);
    if (to) events = events.filter((e) => e.to === to);
    if (contains) events = events.filter((e) => String(e.body || "").includes(contains));

    const slice = events.slice(Math.max(0, events.length - limit));
    slice.forEach((e) => console.log(JSON.stringify(e)));
    if (follow) {
      followEvents(logPath);
    }
    return;
  }

  throw new Error("Command required: agent | setup | send | events");
}

main().catch((err) => {
  const message = err?.message ?? String(err);
  console.error(`Error: ${message}`);
  printUsage();
  process.exit(1);
});
