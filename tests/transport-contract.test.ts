import test from "node:test";
import assert from "node:assert/strict";

type RawEvent = {
  ts: string;
  channel: string;
  from: string;
  to?: string;
  body: string;
  transport: string;
};

type SendAction = {
  channel: string;
  to?: string;
  body: string;
};

class MockTransport {
  private handler: ((event: RawEvent) => Promise<void>) | null = null;

  async start(onMessage: (event: RawEvent) => Promise<void>) {
    this.handler = onMessage;
  }

  async send(action: SendAction) {
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

async function runTransportContract(transport: MockTransport) {
  let receivedBody = "";
  await transport.start(async (event: RawEvent) => {
    receivedBody = event.body;
  });

  await transport.send({ channel: "gossip", body: "hello" });
  assert.equal(receivedBody, "hello");

  await transport.stop();
}

test("transport contract with mock transport", async () => {
  const transport = new MockTransport();
  await runTransportContract(transport);
});
