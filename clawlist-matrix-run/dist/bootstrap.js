import { createClient, register, createRoom, joinRoom, setPowerLevel, setRoomVisibility, checkServer, } from './matrix-api.js';
import { readEnvFile, writeEnvFile, log } from './common.js';
import { join } from 'node:path';
const HOMESERVER = 'http://127.0.0.1:18008';
const MARKET_ALIAS = '#market:localhost';
/** Bootstrap Matrix users and market room */
export async function bootstrap(rootDir) {
    log('bootstrap', `ensuring synapse reachable at ${HOMESERVER}`);
    if (!(await checkServer(HOMESERVER))) {
        throw new Error(`Synapse not reachable at ${HOMESERVER}`);
    }
    const secretsPath = join(rootDir, '.local', 'secrets.env');
    const bootstrapPath = join(rootDir, '.local', 'bootstrap.env');
    // Try to load cached tokens
    const secrets = await readEnvFile(secretsPath);
    let sellerToken = secrets.SELLER_TOKEN;
    let buyerToken = secrets.BUYER_TOKEN;
    let sellerMxid = secrets.SELLER_MXID;
    let buyerMxid = secrets.BUYER_MXID;
    // Create/login seller
    const sellerClient = createClient(HOMESERVER);
    if (sellerToken && sellerMxid) {
        log('bootstrap', `reusing cached seller token for ${sellerMxid}`);
        sellerClient.accessToken = sellerToken;
        sellerClient.userId = sellerMxid;
    }
    else {
        log('bootstrap', 'creating seller user');
        const sellerLogin = await register(sellerClient, 'switch_seller', 'test');
        sellerToken = sellerLogin.access_token;
        sellerMxid = sellerLogin.user_id;
    }
    // Create/login buyer
    const buyerClient = createClient(HOMESERVER);
    if (buyerToken && buyerMxid) {
        log('bootstrap', `reusing cached buyer token for ${buyerMxid}`);
        buyerClient.accessToken = buyerToken;
        buyerClient.userId = buyerMxid;
    }
    else {
        log('bootstrap', 'creating buyer user');
        const buyerLogin = await register(buyerClient, 'switch_buyer', 'test');
        buyerToken = buyerLogin.access_token;
        buyerMxid = buyerLogin.user_id;
    }
    // Save tokens
    await writeEnvFile(secretsPath, {
        SELLER_TOKEN: sellerToken,
        SELLER_MXID: sellerMxid,
        BUYER_TOKEN: buyerToken,
        BUYER_MXID: buyerMxid,
    });
    // Create or join market room
    let roomId;
    try {
        log('bootstrap', `creating market room ${MARKET_ALIAS}`);
        const roomResult = await createRoom(sellerClient, {
            name: 'Marketplace',
            alias: MARKET_ALIAS,
            topic: 'Buy and sell stuff',
            preset: 'public_chat',
            visibility: 'public',
        });
        roomId = roomResult.room_id;
    }
    catch (err) {
        if (err.message.includes('already') || err.message.includes('409') || err.message.includes('400')) {
            log('bootstrap', `market room already exists, joining`);
            const joinResult = await joinRoom(sellerClient, MARKET_ALIAS);
            roomId = joinResult.room_id;
        }
        else {
            throw err;
        }
    }
    // Ensure buyer is joined
    try {
        await joinRoom(buyerClient, roomId);
    }
    catch (err) {
        if (!err.message.includes('already in')) {
            throw err;
        }
    }
    // Grant admin power level
    try {
        await setPowerLevel(sellerClient, roomId, '@admin:localhost', 100);
    }
    catch (err) {
        log('bootstrap', `failed to set admin power level: ${err.message}`);
    }
    // Publish to directory
    try {
        await setRoomVisibility(sellerClient, roomId, 'public');
    }
    catch (err) {
        log('bootstrap', `failed to publish room: ${err.message}`);
    }
    // Write bootstrap env
    const result = {
        sellerMxid,
        sellerToken,
        buyerMxid,
        buyerToken,
        roomId,
        roomAlias: MARKET_ALIAS,
        homeserver: HOMESERVER,
    };
    await writeEnvFile(bootstrapPath, {
        HOMESERVER: HOMESERVER,
        SELLER_MXID: sellerMxid,
        SELLER_TOKEN: sellerToken,
        BUYER_MXID: buyerMxid,
        BUYER_TOKEN: buyerToken,
        ROOM_ID: roomId,
        ROOM_ALIAS: MARKET_ALIAS,
    });
    log('bootstrap', `market room: ${MARKET_ALIAS} (${roomId})`);
    log('bootstrap', `wrote: ${secretsPath}, ${bootstrapPath}`);
    return result;
}
//# sourceMappingURL=bootstrap.js.map