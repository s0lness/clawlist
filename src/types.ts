export type Channel = "gossip" | "dm";

export type RawEvent = {
  ts: string;
  channel: Channel;
  from: string;
  to?: string;
  body: string;
  transport: "matrix";
  room_id?: string;
  event_id?: string;
};

export type AgentConfig = {
  base_url: string;
  user_id: string;
  password?: string;
  device_id?: string;
  access_token?: string;
  persist_access_token?: boolean;
  gossip_room_alias?: string;
  gossip_room_id?: string;
  dm_room_id?: string;
  dm_room_ids?: string[];
  dm_rooms?: Record<string, string>;
  dm_recipient?: string;
  log_dir?: string;
  log_redact?: "none" | "dm" | "all";
  openclaw_url?: string;
  openclaw_token?: string;
  openclaw_timeout_ms?: number;
  openclaw_retry_max?: number;
  openclaw_retry_delay_ms?: number;
  openclaw_queue_max?: number;
  rate_limit_per_sec?: number;
  dedupe_ttl_ms?: number;
  goals: string[];
};

export type Action = {
  channel: Channel;
  to?: string;
  body: string;
};
