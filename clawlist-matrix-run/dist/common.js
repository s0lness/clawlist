import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
/** Check if a port is in use */
export async function portInUse(port) {
    return new Promise((resolve) => {
        const socket = createConnection({ port, host: '127.0.0.1' }, () => {
            socket.destroy();
            resolve(true);
        });
        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });
        socket.setTimeout(100, () => {
            socket.destroy();
            resolve(false);
        });
    });
}
/** Pick a free port starting from the given port */
export async function pickFreePort(startPort) {
    let port = startPort;
    while (await portInUse(port)) {
        port++;
    }
    return port;
}
/** Read env file and parse into object */
export async function readEnvFile(path) {
    try {
        const content = await readFile(path, 'utf-8');
        const env = {};
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#'))
                continue;
            const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
            if (match) {
                env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
            }
        }
        return env;
    }
    catch (err) {
        if (err.code === 'ENOENT')
            return {};
        throw err;
    }
}
/** Write env file (creates parent dirs, chmod 600) */
export async function writeEnvFile(path, env) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
    await writeFile(path, lines.join('\n') + '\n', { mode: 0o600 });
}
/** Append to env file */
export async function appendEnvFile(path, env) {
    const existing = await readEnvFile(path);
    await writeEnvFile(path, { ...existing, ...env });
}
/** Execute a shell command and return stdout */
export async function exec(cmd, cwd) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, {
            shell: true,
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (d) => (stdout += d));
        proc.stderr?.on('data', (d) => (stderr += d));
        proc.on('close', (code) => {
            if (code === 0) {
                resolve(stdout.trim());
            }
            else {
                reject(new Error(`Command failed (exit ${code}): ${cmd}\n${stderr}`));
            }
        });
    });
}
/** Execute a command and stream output */
export async function execStream(cmd, cwd, onStdout, onStderr) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, {
            shell: true,
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        proc.stdout?.on('data', (d) => {
            const lines = d.toString().split('\n');
            lines.forEach((line) => {
                if (line.trim() && onStdout)
                    onStdout(line);
            });
        });
        proc.stderr?.on('data', (d) => {
            const lines = d.toString().split('\n');
            lines.forEach((line) => {
                if (line.trim() && onStderr)
                    onStderr(line);
            });
        });
        proc.on('close', (code) => {
            resolve(code ?? 0);
        });
        proc.on('error', reject);
    });
}
/** Sleep for milliseconds */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Retry a function with exponential backoff */
export async function retry(fn, opts = {}) {
    const { maxAttempts = 3, delayMs = 1000, backoff = 2 } = opts;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            if (attempt < maxAttempts) {
                await sleep(delayMs * Math.pow(backoff, attempt - 1));
            }
        }
    }
    throw lastError || new Error('retry failed');
}
/** Wait for a condition with timeout */
export async function waitFor(condition, opts = {}) {
    const { timeoutMs = 60000, intervalMs = 1000, label = 'condition' } = opts;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await condition())
            return;
        await sleep(intervalMs);
    }
    throw new Error(`Timeout waiting for ${label}`);
}
/** Format timestamp for logging */
export function timestamp() {
    return new Date().toISOString();
}
/** Simple logger */
export function log(component, message) {
    console.log(`[${timestamp()}] [${component}] ${message}`);
}
export function logError(component, message) {
    console.error(`[${timestamp()}] [${component}] ERROR: ${message}`);
}
//# sourceMappingURL=common.js.map