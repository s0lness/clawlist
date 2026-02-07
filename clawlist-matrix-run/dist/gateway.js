import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pickFreePort, portInUse, sleep, log, logError, waitFor } from './common.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
/** Spawn an OpenClaw gateway */
export async function spawnGateway(profile, outDir, requestedPort) {
    await mkdir(outDir, { recursive: true });
    const port = requestedPort || (await pickFreePort(18791));
    if (requestedPort && (await portInUse(requestedPort))) {
        throw new Error(`Port ${requestedPort} is already in use. Stop the existing gateway or omit PORT to auto-pick.`);
    }
    const logPath = join(outDir, `gateway_${profile}.log`);
    const pidPath = join(outDir, `gateway_${profile}.pid`);
    const portPath = join(outDir, `gateway_${profile}.port`);
    log('gateway', `spawning ${profile} on port ${port}, log: ${logPath}`);
    const token = `token-${profile}`;
    const proc = spawn('openclaw', [
        '--profile',
        profile,
        'gateway',
        'run',
        '--port',
        port.toString(),
        '--token',
        token,
        '--force',
        '--compact',
        '--allow-unconfigured',
    ], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            OPENCLAW_GATEWAY_PORT: port.toString(),
            OPENCLAW_GATEWAY_TOKEN: token,
        },
    });
    // Write port immediately
    await writeFile(portPath, port.toString());
    // Collect logs
    const logStream = await import('node:fs').then((fs) => fs.createWriteStream(logPath, { flags: 'w' }));
    proc.stdout?.pipe(logStream);
    proc.stderr?.pipe(logStream);
    const pid = proc.pid;
    log('gateway', `spawned ${profile} with PID ${pid}`);
    // Wait for gateway to be ready by watching log file
    try {
        await waitFor(async () => {
            try {
                const logContent = await readFile(logPath, 'utf-8');
                return logContent.includes(`listening on ws://127.0.0.1:${port}`);
            }
            catch {
                return false;
            }
        }, { timeoutMs: 30000, intervalMs: 200, label: `gateway ${profile} readiness` });
        // Extract real PID from log if available
        const logContent = await readFile(logPath, 'utf-8');
        const pidMatch = logContent.match(/listening on ws:\/\/127\.0\.0\.1:\d+ \(PID (\d+)\)/);
        const realPid = pidMatch ? parseInt(pidMatch[1]) : pid;
        await writeFile(pidPath, realPid.toString());
        proc.unref(); // Allow process to continue after parent exits
        return {
            profile,
            port,
            pid: realPid,
            logPath,
            pidPath,
            portPath,
        };
    }
    catch (err) {
        logError('gateway', `Failed to start gateway ${profile}`);
        proc.kill();
        throw err;
    }
}
/** Stop a gateway process */
export async function stopGateway(gateway) {
    log('gateway', `stopping ${gateway.profile} (PID ${gateway.pid})`);
    try {
        process.kill(gateway.pid, 'SIGTERM');
        // Wait for process to exit
        await waitFor(async () => {
            try {
                process.kill(gateway.pid, 0); // Check if process exists
                return false;
            }
            catch {
                return true; // Process doesn't exist = stopped
            }
        }, { timeoutMs: 5000, intervalMs: 200, label: `gateway ${gateway.profile} shutdown` });
        log('gateway', `stopped ${gateway.profile}`);
    }
    catch (err) {
        if (err.code === 'ESRCH') {
            log('gateway', `${gateway.profile} already stopped`);
        }
        else {
            logError('gateway', `failed to stop ${gateway.profile}: ${err.message}`);
        }
    }
}
/** Stop all gateways in a run directory */
export async function stopAllGateways(outDir) {
    log('gateway', `stopping all gateways in ${outDir}`);
    const fs = await import('node:fs/promises');
    try {
        const files = await fs.readdir(outDir);
        const pidFiles = files.filter((f) => f.startsWith('gateway_') && f.endsWith('.pid'));
        for (const pidFile of pidFiles) {
            const pidPath = join(outDir, pidFile);
            const pidStr = await fs.readFile(pidPath, 'utf-8');
            const pid = parseInt(pidStr.trim());
            if (!isNaN(pid)) {
                try {
                    process.kill(pid, 'SIGTERM');
                    log('gateway', `sent SIGTERM to PID ${pid}`);
                }
                catch (err) {
                    if (err.code !== 'ESRCH') {
                        logError('gateway', `failed to kill PID ${pid}: ${err.message}`);
                    }
                }
            }
        }
        await sleep(1000); // Give processes time to exit
    }
    catch (err) {
        logError('gateway', `error stopping gateways: ${err.message}`);
    }
}
/** Stop gateway by profile name */
export async function stopGatewayByProfile(profile) {
    log('gateway', `stopping gateway for profile ${profile}`);
    const { exec } = await import('./common.js');
    try {
        // Try openclaw gateway stop first
        await exec(`openclaw --profile "${profile}" gateway stop`).catch(() => {
            // If that fails, try to kill the process directly
        });
        // Also kill any lingering processes
        await exec(`pkill -f "openclaw.*--profile ${profile}.*gateway run" || true`);
        await sleep(500);
    }
    catch (err) {
        // Best effort, don't fail if cleanup fails
    }
}
/** Cleanup stuck ports */
export async function cleanupPorts() {
    log('gateway', 'cleaning up stuck ports');
    const { exec } = await import('./common.js');
    try {
        const portsInUse = await exec(`ss -ltnp 2>/dev/null | grep -E ':(1879[0-9]|188[0-9]{2})' | grep openclaw || true`);
        if (portsInUse.trim()) {
            log('gateway', `found stuck openclaw ports:\n${portsInUse}`);
            // Extract PIDs and kill them, BUT exclude:
            // 1. The current process (don't kill ourselves!)
            // 2. The parent process (main gateway on 18789)
            const currentPid = process.pid;
            const parentPid = process.ppid;
            const pids = portsInUse.match(/pid=(\d+)/g);
            if (pids) {
                for (const pidMatch of pids) {
                    const pid = parseInt(pidMatch.replace('pid=', ''));
                    // Skip our own process and parent
                    if (pid === currentPid || pid === parentPid) {
                        log('gateway', `skipping PID ${pid} (self or parent)`);
                        continue;
                    }
                    try {
                        process.kill(pid, 'SIGTERM');
                        log('gateway', `killed stuck process ${pid}`);
                    }
                    catch (err) {
                        if (err.code !== 'ESRCH') {
                            logError('gateway', `failed to kill ${pid}: ${err.message}`);
                        }
                    }
                }
            }
        }
        else {
            log('gateway', 'no stuck ports found');
        }
    }
    catch (err) {
        logError('gateway', `cleanup failed: ${err.message}`);
    }
}
//# sourceMappingURL=gateway.js.map