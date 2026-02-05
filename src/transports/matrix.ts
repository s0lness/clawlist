import { Action, RawEvent } from "../types";
import { MessageHandler, Transport } from "../transport";
import { getClient, ensureJoined } from "../matrix";

export class MatrixTransport implements Transport {
  private configPath: string;
  private gossipRoomId: string | null = null;
  private dmRoomId: string | null = null;
  private userId: string | null = null;
  private client: any;

  constructor(configPath: string) {
    this.configPath = configPath;
  }

  async start(onMessage: MessageHandler): Promise<void> {
    const { client, config } = await getClient(this.configPath);
    this.client = client;
    this.userId = config.user_id;
    this.gossipRoomId = config.gossip_room_id ?? null;
    this.dmRoomId = config.dm_room_id ?? null;

    if (!this.gossipRoomId) {
      throw new Error("gossip_room_id is required. Run setup first.");
    }
    if (!this.dmRoomId) {
      throw new Error("dm_room_id is required. Run setup first.");
    }

    await ensureJoined(client, this.gossipRoomId);
    await ensureJoined(client, this.dmRoomId);

    client.on("Room.timeline", async (event: any, room: any, toStartOfTimeline: boolean) => {
      if (toStartOfTimeline) return;
      if (event.getType() !== "m.room.message") return;
      const content = event.getContent();
      if (!content || content.msgtype !== "m.text") return;

      const body = String(content.body ?? "");
      const sender = String(event.getSender() ?? "unknown");
      if (this.userId && sender === this.userId) return;

      const roomId = String(room?.roomId ?? "");
      const channel = roomId === this.gossipRoomId ? "gossip" : roomId === this.dmRoomId ? "dm" : null;
      if (!channel) return;

      const ts = new Date(event.getTs ? event.getTs() : Date.now()).toISOString();
      const raw: RawEvent = {
        ts,
        channel,
        from: sender,
        to: channel === "dm" && this.userId ? this.userId : undefined,
        body,
        transport: "matrix",
      };
      await onMessage(raw);
    });

    client.startClient({ initialSyncLimit: 0 });
  }

  async send(action: Action): Promise<void> {
    if (!this.client) throw new Error("Matrix client not initialized");
    if (action.channel === "gossip") {
      if (!this.gossipRoomId) throw new Error("gossip_room_id missing");
      await this.client.sendEvent(
        this.gossipRoomId,
        "m.room.message",
        { msgtype: "m.text", body: action.body },
        ""
      );
      return;
    }
    if (!this.dmRoomId) throw new Error("dm_room_id missing");
    await this.client.sendEvent(
      this.dmRoomId,
      "m.room.message",
      { msgtype: "m.text", body: action.body },
      ""
    );
  }
}
