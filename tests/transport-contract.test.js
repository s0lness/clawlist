const test = require("node:test");
const assert = require("node:assert/strict");

class MockTransport {
  constructor() {
    this.handler = null;
  }

  async start(onMessage) {
    this.handler = onMessage;
  }

  async send(action) {
    if (!this.handler) throw new Error("start must be called first");
    await this.handler({
      ts: new Date().toISOString(),
      channel: action.channel,
      from: "@mock:localhost",
      to: action.to,
      body: action.body,
      transport: "matrix",
    });
  }

  async stop() {
    this.handler = null;
  }
}

async function runTransportContract(transport) {
  let received = null;
  await transport.start(async (event) => {
    received = event;
  });

  await transport.send({ channel: "gossip", body: "hello" });
  assert.ok(received);
  assert.equal(received.body, "hello");

  await transport.stop();
}

test("transport contract with mock transport", async () => {
  const transport = new MockTransport();
  await runTransportContract(transport);
});
