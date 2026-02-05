export type Channel = "gossip" | "dm";

export type RawEvent = {
  ts: string;
  channel: Channel;
  from: string;
  to?: string;
  body: string;
  transport: "matrix";
};

export type PolicyConfig =
  | {
      kind: "none";
    }
  | {
      kind: "basic";
    };

export type AgentConfig = {
  base_url: string;
  user_id: string;
  password: string;
  device_id?: string;
  access_token?: string;
  gossip_room_alias?: string;
  gossip_room_id?: string;
  dm_room_id?: string;
  log_dir?: string;
  goals: string[];
  policy?: PolicyConfig;
};

export type Action = {
  channel: Channel;
  to?: string;
  body: string;
};
