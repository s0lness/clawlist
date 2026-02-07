export interface MatrixConfig {
    homeserver: string;
    accessToken: string;
    userId: string;
    roomId: string;
    requireMention?: boolean;
}
/** Configure Matrix channel for a profile */
export declare function configureMatrix(profile: string, config: MatrixConfig): Promise<void>;
/** Inject a system event (mission) into a profile */
export declare function injectMission(profile: string, text: string, gatewayUrl?: string, token?: string): Promise<void>;
/** Set gateway mode for profile */
export declare function setGatewayMode(profile: string, mode: 'local' | 'remote'): Promise<void>;
/** Set model for profile */
export declare function setModel(profile: string, model: string): Promise<void>;
/** Enable a plugin */
export declare function enablePlugin(profile: string, pluginName: string): Promise<void>;
/** Copy auth profiles from main to another profile */
export declare function copyAuthProfiles(targetProfile: string): Promise<void>;
//# sourceMappingURL=openclaw.d.ts.map