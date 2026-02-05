# Architecture

## Components
- CLI entry point: `src/cli.ts`
- Agent runtime: `src/agent.ts`
- Transport interface: `src/transport.ts`
- Matrix transport: `src/transports/matrix.ts`
- Matrix client helper: `src/matrix.ts`
- Config loader: `src/config.ts`
- Event log: `src/log.ts`

## Data Shape
- Raw event: `RawEvent` in `src/types.ts`
- Fields: `ts`, `channel`, `from`, `to?`, `body`, `transport`, `room_id?`, `event_id?`

## Flow
1. CLI `agent` loads config.
2. Matrix transport joins gossip + DM rooms.
3. Incoming Matrix events are normalized to `RawEvent`.
4. Events are logged to `logs/events.jsonl`.
5. Optional OpenClaw webhook receives the event.
