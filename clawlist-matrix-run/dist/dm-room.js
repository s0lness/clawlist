import { createClient, createRoom, joinRoom } from './matrix-api.js';
import { log } from './common.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
/** Create a per-run DM room between seller and buyer */
export async function createDmRoom(homeserver, sellerMxid, sellerToken, buyerMxid, buyerToken, runId, outDir) {
    await mkdir(outDir, { recursive: true });
    log('dm-room', `creating DM room for ${runId}`);
    // Create room as seller
    const sellerClient = createClient(homeserver, sellerToken);
    sellerClient.userId = sellerMxid;
    const roomResult = await createRoom(sellerClient, {
        name: `DM: ${runId}`,
        isDirect: true,
        preset: 'trusted_private_chat',
        invite: [buyerMxid, '@admin:localhost'],
    });
    const dmRoomId = roomResult.room_id;
    // Buyer joins the room
    const buyerClient = createClient(homeserver, buyerToken);
    buyerClient.userId = buyerMxid;
    buyerClient.accessToken = buyerToken;
    await joinRoom(buyerClient, dmRoomId);
    const meta = {
        runId,
        dmRoomId,
        seller: { mxid: sellerMxid },
        buyer: { mxid: buyerMxid },
    };
    // Write meta.json
    const metaPath = join(outDir, 'meta.json');
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
    log('dm-room', `created DM room: ${dmRoomId}`);
    log('dm-room', `wrote: ${metaPath}`);
    return meta;
}
/** Load DM room meta from a run directory */
export async function loadDmRoomMeta(outDir) {
    const metaPath = join(outDir, 'meta.json');
    const content = await readFile(metaPath, 'utf-8');
    return JSON.parse(content);
}
//# sourceMappingURL=dm-room.js.map