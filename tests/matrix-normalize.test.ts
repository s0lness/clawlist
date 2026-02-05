import test from "node:test";
import assert from "node:assert/strict";

const { normalizeMatrixEvent } = require("../dist/transports/matrix.js") as {
  normalizeMatrixEvent: (args: {
    event: unknown;
    room: { roomId: string };
    userId: string;
    gossipRoomId: string;
    dmRoomIds: Set<string>;
  }) =>
    | {
        channel: string;
        body: string;
        room_id: string;
        event_id: string;
        to?: string;
      }
    | null;
};

function makeEvent({
  type = "m.room.message",
  msgtype = "m.text",
  body = "hi",
  sender = "@b:localhost",
  ts = 0,
  id = "$event",
}: {
  type?: string;
  msgtype?: string;
  body?: string;
  sender?: string;
  ts?: number;
  id?: string;
} = {}) {
  return {
    getType: () => type,
    getContent: () => ({ msgtype, body }),
    getSender: () => sender,
    getTs: () => ts,
    getId: () => id,
  };
}

test("normalizeMatrixEvent returns gossip event with ids", () => {
  const raw = normalizeMatrixEvent({
    event: makeEvent(),
    room: { roomId: "!gossip" },
    userId: "@a:localhost",
    gossipRoomId: "!gossip",
    dmRoomIds: new Set(["!dm"]),
  });

  assert.ok(raw);
  assert.equal(raw.channel, "gossip");
  assert.equal(raw.body, "hi");
  assert.equal(raw.room_id, "!gossip");
  assert.equal(raw.event_id, "$event");
  assert.equal(raw.to, undefined);
});

test("normalizeMatrixEvent returns dm event with recipient", () => {
  const raw = normalizeMatrixEvent({
    event: makeEvent({ body: "yo" }),
    room: { roomId: "!dm" },
    userId: "@a:localhost",
    gossipRoomId: "!gossip",
    dmRoomIds: new Set(["!dm"]),
  });

  assert.ok(raw);
  assert.equal(raw.channel, "dm");
  assert.equal(raw.to, "@a:localhost");
});

test("normalizeMatrixEvent ignores self messages", () => {
  const raw = normalizeMatrixEvent({
    event: makeEvent({ sender: "@a:localhost" }),
    room: { roomId: "!gossip" },
    userId: "@a:localhost",
    gossipRoomId: "!gossip",
    dmRoomIds: new Set(["!dm"]),
  });

  assert.equal(raw, null);
});

test("normalizeMatrixEvent ignores non-text messages", () => {
  const raw = normalizeMatrixEvent({
    event: makeEvent({ msgtype: "m.image" }),
    room: { roomId: "!gossip" },
    userId: "@a:localhost",
    gossipRoomId: "!gossip",
    dmRoomIds: new Set(["!dm"]),
  });

  assert.equal(raw, null);
});
