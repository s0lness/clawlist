import { AgentConfig, RawEvent } from "./types";
import { decideActions } from "./policy";
import { logEvent } from "./log";
import { MatrixTransport } from "./transports/matrix";
import { loadConfig } from "./config";

export function startAgent(configPath: string) {
  const config = loadConfig(configPath);
  const policy = config.policy ?? { kind: "none" };
  const transport = new MatrixTransport(configPath);
  const logDir = config.log_dir ?? "logs";

  async function handleEvent(event: RawEvent) {
    logEvent(event, logDir);
    const actions = await decideActions(config.user_id, config.goals, event, policy);
    for (const action of actions) {
      await transport.send(action);
    }
  }

  transport.start(handleEvent);

  console.log(`Agent running: ${config.user_id}`);
}
