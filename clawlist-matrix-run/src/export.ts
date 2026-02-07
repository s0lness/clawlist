import { createClient, getMessages, RoomEvent } from './matrix-api.js';
import { loadDmRoomMeta } from './dm-room.js';
import { log } from './common.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Export room messages to JSONL */
async function exportRoom(
  homeserver: string,
  accessToken: string,
  roomId: string,
  outputPath: string,
  limit: number = 1000
): Promise<void> {
  const client = createClient(homeserver, accessToken);

  log('export', `exporting ${roomId} to ${outputPath} (limit: ${limit})`);

  const messages: RoomEvent[] = [];
  let from: string | undefined;

  // Paginate backwards through room history
  for (let i = 0; i < Math.ceil(limit / 100); i++) {
    const result = await getMessages(client, roomId, { limit: 100, from, dir: 'b' });

    if (result.chunk.length === 0) break;

    messages.push(...result.chunk);
    from = result.end;

    if (messages.length >= limit) break;
  }

  // Reverse to chronological order
  messages.reverse();

  // Write as JSONL
  const jsonl = messages.map((msg) => JSON.stringify(msg)).join('\n');
  await mkdir(join(outputPath, '..'), { recursive: true });
  await writeFile(outputPath, jsonl + '\n');

  log('export', `exported ${messages.length} messages to ${outputPath}`);
}

/** Export market room and DM room for a run */
export async function exportRun(
  homeserver: string,
  marketRoomId: string,
  sellerToken: string,
  outDir: string,
  marketMessageLimit: number = 500,
  dmMessageLimit: number = 200
): Promise<void> {
  log('export', `exporting run from ${outDir}`);

  // Export market room
  const marketPath = join(outDir, 'market.jsonl');
  await exportRoom(homeserver, sellerToken, marketRoomId, marketPath, marketMessageLimit);

  // Export DM room
  try {
    const meta = await loadDmRoomMeta(outDir);
    const dmPath = join(outDir, 'dm.jsonl');
    await exportRoom(homeserver, sellerToken, meta.dmRoomId, dmPath, dmMessageLimit);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      log('export', 'no meta.json found, skipping DM export');
    } else {
      throw err;
    }
  }

  log('export', 'export complete');
}
