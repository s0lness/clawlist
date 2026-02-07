export interface GatewayProcess {
    profile: string;
    port: number;
    pid: number;
    logPath: string;
    pidPath: string;
    portPath: string;
}
/** Spawn an OpenClaw gateway */
export declare function spawnGateway(profile: string, outDir: string, requestedPort?: number): Promise<GatewayProcess>;
/** Stop a gateway process */
export declare function stopGateway(gateway: GatewayProcess): Promise<void>;
/** Stop all gateways in a run directory */
export declare function stopAllGateways(outDir: string): Promise<void>;
/** Stop gateway by profile name */
export declare function stopGatewayByProfile(profile: string): Promise<void>;
/** Cleanup stuck ports */
export declare function cleanupPorts(): Promise<void>;
//# sourceMappingURL=gateway.d.ts.map