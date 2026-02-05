import { Action, RawEvent } from "./types";

export type MessageHandler = (event: RawEvent) => void | Promise<void>;

export interface Transport {
  start(onMessage: MessageHandler): void | Promise<void>;
  send(action: Action): void | Promise<void>;
  stop?(): void | Promise<void>;
}
