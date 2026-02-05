import sdk from "matrix-js-sdk";
import { AgentConfig } from "./types";
import { loadConfig, saveConfig } from "./config";

export async function getClient(configPath: string) {
  const config = loadConfig(configPath);

  if (config.access_token) {
    const client: any = sdk.createClient({
      baseUrl: config.base_url,
      accessToken: config.access_token,
      userId: config.user_id,
      deviceId: config.device_id,
    });
    return { client, config };
  }

  const baseClient: any = sdk.createClient({ baseUrl: config.base_url });
  const loginRes = await baseClient.login("m.login.password", {
    user: config.user_id,
    password: config.password,
    device_id: config.device_id,
  });

  config.access_token = loginRes.access_token;
  config.user_id = loginRes.user_id;
  config.device_id = loginRes.device_id;
  saveConfig(configPath, config);

  const client: any = sdk.createClient({
    baseUrl: config.base_url,
    accessToken: loginRes.access_token,
    userId: loginRes.user_id,
    deviceId: loginRes.device_id,
  });

  return { client, config };
}

export function normalizeAlias(alias?: string) {
  if (!alias) return null;
  if (alias.startsWith("#")) return alias;
  return `#${alias}`;
}

export async function ensureJoined(client: any, roomIdOrAlias: string) {
  const joined = await client.joinRoom(roomIdOrAlias);
  return typeof joined === "string" ? joined : joined.roomId;
}
