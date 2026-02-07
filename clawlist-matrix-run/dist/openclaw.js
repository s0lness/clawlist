import { exec, log } from './common.js';
/** Configure Matrix channel for a profile */
export async function configureMatrix(profile, config) {
    log('openclaw', `configuring Matrix for profile ${profile}`);
    const matrixChannel = {
        enabled: true,
        homeserver: config.homeserver,
        accessToken: config.accessToken,
        userId: config.userId,
        encryption: false,
        dm: { policy: 'open', allowFrom: ['*'] },
        groupPolicy: 'open',
        groups: {
            '*': { requireMention: config.requireMention ?? false },
            [config.roomId]: { allow: true, requireMention: config.requireMention ?? false },
        },
    };
    await exec(`openclaw --profile "${profile}" config set --json 'channels.matrix' '${JSON.stringify(matrixChannel)}'`);
}
/** Inject a system event (mission) into a profile */
export async function injectMission(profile, text, gatewayUrl, token) {
    log('openclaw', `injecting mission into ${profile}: ${text.substring(0, 60)}...`);
    let cmd = `openclaw --profile "${profile}" system event`;
    if (gatewayUrl) {
        cmd += ` --url "${gatewayUrl}"`;
    }
    if (token) {
        cmd += ` --token "${token}"`;
    }
    cmd += ` --text "${text.replace(/"/g, '\\"')}"`;
    await exec(cmd);
}
/** Set gateway mode for profile */
export async function setGatewayMode(profile, mode) {
    log('openclaw', `setting gateway mode for ${profile} to ${mode}`);
    await exec(`openclaw --profile "${profile}" config set gateway.mode ${mode}`);
}
/** Set model for profile */
export async function setModel(profile, model) {
    log('openclaw', `setting model for ${profile} to ${model}`);
    await exec(`openclaw --profile "${profile}" config set agents.defaults.model.primary "${model}"`);
}
/** Enable a plugin */
export async function enablePlugin(profile, pluginName) {
    log('openclaw', `enabling plugin ${pluginName} for ${profile}`);
    await exec(`openclaw --profile "${profile}" config set plugins.entries.${pluginName}.enabled true`);
}
/** Copy auth profiles from main to another profile */
export async function copyAuthProfiles(targetProfile) {
    log('openclaw', `copying auth profiles to ${targetProfile}`);
    const homeDir = process.env.HOME || '';
    const mainAuthFile = `${homeDir}/.openclaw/agents/main/agent/auth-profiles.json`;
    const targetDir = `${homeDir}/.openclaw-${targetProfile}/agents/main/agent`;
    await exec(`mkdir -p "${targetDir}"`);
    await exec(`[ -f "${mainAuthFile}" ] && cp "${mainAuthFile}" "${targetDir}/auth-profiles.json" || true`);
}
//# sourceMappingURL=openclaw.js.map