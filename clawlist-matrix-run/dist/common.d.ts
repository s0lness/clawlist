/** Check if a port is in use */
export declare function portInUse(port: number): Promise<boolean>;
/** Pick a free port starting from the given port */
export declare function pickFreePort(startPort: number): Promise<number>;
/** Read env file and parse into object */
export declare function readEnvFile(path: string): Promise<Record<string, string>>;
/** Write env file (creates parent dirs, chmod 600) */
export declare function writeEnvFile(path: string, env: Record<string, string>): Promise<void>;
/** Append to env file */
export declare function appendEnvFile(path: string, env: Record<string, string>): Promise<void>;
/** Execute a shell command and return stdout */
export declare function exec(cmd: string, cwd?: string): Promise<string>;
/** Execute a command and stream output */
export declare function execStream(cmd: string, cwd?: string, onStdout?: (line: string) => void, onStderr?: (line: string) => void): Promise<number>;
/** Sleep for milliseconds */
export declare function sleep(ms: number): Promise<void>;
/** Retry a function with exponential backoff */
export declare function retry<T>(fn: () => Promise<T>, opts?: {
    maxAttempts?: number;
    delayMs?: number;
    backoff?: number;
}): Promise<T>;
/** Wait for a condition with timeout */
export declare function waitFor(condition: () => Promise<boolean>, opts?: {
    timeoutMs?: number;
    intervalMs?: number;
    label?: string;
}): Promise<void>;
/** Format timestamp for logging */
export declare function timestamp(): string;
/** Simple logger */
export declare function log(component: string, message: string): void;
export declare function logError(component: string, message: string): void;
//# sourceMappingURL=common.d.ts.map