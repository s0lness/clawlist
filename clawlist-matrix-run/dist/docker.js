import { exec, execStream, log, retry } from './common.js';
import { checkServer } from './matrix-api.js';
import { join } from 'node:path';
const HOMESERVER = 'http://127.0.0.1:18008';
const ELEMENT_UI = 'http://127.0.0.1:18080';
/** Check if docker is available */
async function checkDocker() {
    try {
        await exec('docker --version');
    }
    catch {
        throw new Error('docker not found. Please install Docker.');
    }
}
/** Get docker compose command */
async function getComposeCommand() {
    // Try docker compose (v2 plugin)
    try {
        await exec('docker compose version');
        return 'docker compose';
    }
    catch {
        // Fall back to docker-compose
        try {
            const composePath = await exec('command -v docker-compose');
            // Avoid Windows docker-compose under WSL
            if (composePath.includes('/mnt/c/')) {
                throw new Error('docker-compose resolves to Windows binary. Install docker compose plugin instead.');
            }
            return 'docker-compose';
        }
        catch {
            throw new Error('Neither "docker compose" nor "docker-compose" is available. ' +
                'Install: sudo apt-get install -y docker-compose-plugin');
        }
    }
}
/** Start Synapse + Element */
export async function up(rootDir) {
    await checkDocker();
    const composeCmd = await getComposeCommand();
    const composeFile = join(rootDir, 'infra', 'docker-compose.yml');
    log('docker', 'starting synapse + element (local-only)');
    await execStream(`${composeCmd} -f "${composeFile}" up -d`, rootDir, (line) => log('docker', line));
    log('docker', `waiting for synapse at ${HOMESERVER}`);
    await retry(async () => {
        const ready = await checkServer(HOMESERVER);
        if (!ready)
            throw new Error('Synapse not ready');
    }, { maxAttempts: 60, delayMs: 1000 });
    log('docker', 'synapse is up');
    log('docker', `Element UI: ${ELEMENT_UI}`);
    log('docker', `Synapse: ${HOMESERVER}`);
}
/** Stop Synapse + Element */
export async function down(rootDir) {
    const composeCmd = await getComposeCommand();
    const composeFile = join(rootDir, 'infra', 'docker-compose.yml');
    log('docker', 'stopping synapse + element');
    await execStream(`${composeCmd} -f "${composeFile}" down`, rootDir, (line) => log('docker', line));
    log('docker', 'stopped');
}
/** Check if Synapse is running */
export async function isUp() {
    return checkServer(HOMESERVER);
}
//# sourceMappingURL=docker.js.map