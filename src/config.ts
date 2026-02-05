import fs from "fs";
import { AgentConfig } from "./types";

export function loadConfig(path: string): AgentConfig {
  const raw = fs.readFileSync(path, "utf8");
  return JSON.parse(raw) as AgentConfig;
}

export function saveConfig(path: string, config: AgentConfig): void {
  fs.writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf8");
}
