#!/usr/bin/env node
import { join } from 'node:path';
import { loadScenario, generateSellerMission, generateBuyerMission, generateMarketListing } from './scenario.js';
import { bootstrap } from './bootstrap.js';
import { createDmRoom } from './dm-room.js';
import { spawnGateway, stopGateway, stopGatewayByProfile } from './gateway.js';
import { configureMatrix, injectMission, setGatewayMode, setModel, enablePlugin, copyAuthProfiles } from './openclaw.js';
import { sendMessage, createClient } from './matrix-api.js';
import { exportRun } from './export.js';
import { scoreRun } from './score.js';
import { sleep, log, logError } from './common.js';
import { symlink, mkdir } from 'node:fs/promises';
const ROOT_DIR = process.cwd();
async function main() {
    const scenarioName = process.argv[2];
    if (!scenarioName) {
        console.error('usage: run-scenario.ts <scenarioName>');
        process.exit(2);
    }
    const durationSec = parseInt(process.env.DURATION_SEC || '120');
    const runId = process.env.RUN_ID || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '_').substring(0, 15);
    log('run-scenario', `scenario=${scenarioName} runId=${runId} duration=${durationSec}s`);
    // Load scenario
    const scenario = await loadScenario(ROOT_DIR, scenarioName);
    // Bootstrap (no global cleanup - we manage our own spawned gateways)
    const bootstrapResult = await bootstrap(ROOT_DIR);
    const outDir = join(ROOT_DIR, 'runs', runId, 'out');
    await mkdir(outDir, { recursive: true });
    // Configure seller profile
    log('run-scenario', `configuring ${scenario.seller.profile}`);
    await setGatewayMode(scenario.seller.profile, 'local');
    await setModel(scenario.seller.profile, process.env.AGENT_MODEL || 'anthropic/claude-sonnet-4-5');
    await enablePlugin(scenario.seller.profile, 'matrix');
    await copyAuthProfiles(scenario.seller.profile);
    await configureMatrix(scenario.seller.profile, {
        homeserver: bootstrapResult.homeserver,
        accessToken: bootstrapResult.sellerToken,
        userId: bootstrapResult.sellerMxid,
        roomId: bootstrapResult.roomId,
        requireMention: false,
    });
    // Configure buyer profile
    log('run-scenario', `configuring ${scenario.buyer.profile}`);
    await setGatewayMode(scenario.buyer.profile, 'local');
    await setModel(scenario.buyer.profile, process.env.AGENT_MODEL || 'anthropic/claude-sonnet-4-5');
    await enablePlugin(scenario.buyer.profile, 'matrix');
    await copyAuthProfiles(scenario.buyer.profile);
    await configureMatrix(scenario.buyer.profile, {
        homeserver: bootstrapResult.homeserver,
        accessToken: bootstrapResult.buyerToken,
        userId: bootstrapResult.buyerMxid,
        roomId: bootstrapResult.roomId,
        requireMention: false,
    });
    // Clean up any existing gateways for these profiles
    await stopGatewayByProfile(scenario.seller.profile);
    await stopGatewayByProfile(scenario.buyer.profile);
    // Spawn gateways (auto-pick free ports)
    log('run-scenario', 'spawning gateways');
    const sellerGateway = await spawnGateway(scenario.seller.profile, outDir);
    const buyerGateway = await spawnGateway(scenario.buyer.profile, outDir);
    // Create DM room
    const dmMeta = await createDmRoom(bootstrapResult.homeserver, bootstrapResult.sellerMxid, bootstrapResult.sellerToken, bootstrapResult.buyerMxid, bootstrapResult.buyerToken, runId, outDir);
    // Inject missions
    const sellerGatewayUrl = `http://127.0.0.1:${sellerGateway.port}`;
    const buyerGatewayUrl = `http://127.0.0.1:${buyerGateway.port}`;
    const sellerToken = `token-${scenario.seller.profile}`;
    const buyerToken = `token-${scenario.buyer.profile}`;
    await injectMission(scenario.seller.profile, generateSellerMission(scenario), sellerGatewayUrl, sellerToken);
    await injectMission(scenario.buyer.profile, generateBuyerMission(scenario), buyerGatewayUrl, buyerToken);
    // Nudge buyer to check market
    await injectMission(scenario.buyer.profile, `NUDGE: Go to #market:localhost now, find the latest listing with RUN_ID:${runId}, and DM the seller immediately.`, buyerGatewayUrl, buyerToken);
    // Seed market listing
    log('run-scenario', 'seeding market listing');
    const sellerClient = createClient(bootstrapResult.homeserver, bootstrapResult.sellerToken);
    sellerClient.userId = bootstrapResult.sellerMxid;
    const listingText = generateMarketListing(scenario, runId);
    await sendMessage(sellerClient, bootstrapResult.roomId, listingText);
    // Let agents run
    log('run-scenario', `running for ${durationSec}s`);
    await sleep(durationSec * 1000);
    // Stop gateways
    log('run-scenario', 'stopping gateways');
    await stopGateway(sellerGateway);
    await stopGateway(buyerGateway);
    // Export transcripts
    await exportRun(bootstrapResult.homeserver, bootstrapResult.roomId, bootstrapResult.sellerToken, outDir);
    // Score
    await scoreRun(outDir, scenario);
    // Create latest symlink
    try {
        await symlink(join(ROOT_DIR, 'runs', runId), join(ROOT_DIR, 'runs', 'latest'));
    }
    catch {
        // Ignore if symlink already exists
    }
    log('run-scenario', `done: ${runId}`);
    log('run-scenario', `summary: ${join(outDir, 'summary.json')}`);
}
main().catch((err) => {
    logError('run-scenario', err.message);
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=run-scenario.js.map