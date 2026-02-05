// @ts-nocheck
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  appendJsonl,
  encodeMxid,
  ensureDir,
  fetchJson,
  fetchRetry,
  findOnPath,
  hasDockerContainer,
  nowRunId,
  parseEnvLines,
  pickFreePort,
  readEnvFile,
  run,
  runCapture,
  sleep,
  spawnToFile,
  tailFile,
  waitForPort,
  writeEnvFile,
} from "./common";

async function main() {
  const root = path.resolve(__dirname, "../../");
  const matrixRunRoot = root;

  const runId = process.env.RUN_ID || nowRunId();
  const runDir = path.join(matrixRunRoot, "runs", runId);
  const outDir = path.join(runDir, "out");
  ensureDir(outDir);

  const openclaw = process.env.OPENCLAW || findOnPath("openclaw");
  const npmBin = process.env.NPM || findOnPath("npm");
  const stepsLog = path.join(outDir, "steps.jsonl");

  if (!openclaw) throw new Error("openclaw not found in PATH. Set OPENCLAW=/path/to/openclaw");
  if (!npmBin) throw new Error("npm not found in PATH. Set NPM=/path/to/npm");

  const state = {
    runId,
    outDir,
    stepsLog,
    sellerProfile: "switch-seller",
    buyerProfile: "switch-buyer",
    matrixReuse: String(process.env.MATRIX_REUSE || "1") === "1",
    bootstrapRaw: path.join(outDir, "bootstrap.raw"),
    synapseLogPid: null,
    sellerProc: null,
    buyerProc: null,
    cleaned: false,
  };

  function logStep(step: string, status: string, msg = "") {
    appendJsonl(stepsLog, { ts: new Date().toISOString(), step, status, msg });
  }

  function dumpLogs() {
    console.error(`\n[diag] run failed. run_id=${state.runId} out_dir=${outDir}`);
    const dumps: [string, string, number][] = [
      ["steps", stepsLog, 200],
      ["bootstrap", state.bootstrapRaw, 120],
      ["synapse", path.join(outDir, "synapse.log"), 120],
      ["seller gateway", path.join(outDir, `gateway_${state.sellerProfile}.log`), 160],
      ["buyer gateway", path.join(outDir, `gateway_${state.buyerProfile}.log`), 160],
      ["seller mission cmd", path.join(outDir, `system_event_${state.sellerProfile}.log`), 120],
      ["buyer mission cmd", path.join(outDir, `system_event_${state.buyerProfile}.log`), 120],
      ["npm install (built-in matrix plugin)", path.join(outDir, "npm_install_matrix_builtin.log"), 120],
    ];

    for (const [label, file, lines] of dumps) {
      const tail = tailFile(file, lines);
      if (tail == null) console.error(`\n[diag] --- ${label} missing: ${file} ---`);
      else {
        console.error(`\n[diag] --- ${label} (tail -n ${lines} ${file}) ---`);
        console.error(tail);
      }
    }
  }

  function cleanup() {
    if (state.cleaned) return;
    state.cleaned = true;

    console.error("[run] stopping gateways");
    for (const p of [state.sellerProc, state.buyerProc]) {
      if (p && !p.killed) {
        try { p.kill("SIGTERM"); } catch {}
      }
    }

    console.error("[run] stopping synapse");
    if (state.synapseLogPid && !state.synapseLogPid.killed) {
      try { state.synapseLogPid.kill("SIGTERM"); } catch {}
    }

    if (state.matrixReuse) console.error("[run] MATRIX_REUSE=1 -> keeping synapse running");
    else run("docker", ["rm", "-f", "clawlist-synapse"], { allowFail: true, stdio: "pipe" });
  }

  let interrupted = false;
  const onSignal = (sig: string) => {
    if (interrupted) return;
    interrupted = true;
    console.error(`[run] received ${sig}, shutting down`);
    cleanup();
    process.exit(1);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  try {
    let sellerGatewayPort = Number(process.env.SELLER_GATEWAY_PORT || 28791);
    let buyerGatewayPort = Number(process.env.BUYER_GATEWAY_PORT || 28792);
    sellerGatewayPort = await pickFreePort(sellerGatewayPort);
    if (buyerGatewayPort === sellerGatewayPort) buyerGatewayPort = sellerGatewayPort + 1;
    buyerGatewayPort = await pickFreePort(buyerGatewayPort);
    console.error(`[run] using gateway ports: seller=${sellerGatewayPort} buyer=${buyerGatewayPort}`);

    const sellerGatewayToken = process.env.SELLER_GATEWAY_TOKEN || "token-switch-seller";
    const buyerGatewayToken = process.env.BUYER_GATEWAY_TOKEN || "token-switch-buyer";

    const matrixBootstrapOut = path.join(outDir, "bootstrap.env");
    const secretsFileDefault = path.join(outDir, "secrets.env");

    let matrixBootstrapOutPath = matrixBootstrapOut;
    let secretsFile = secretsFileDefault;

    const runEnv = { ...process.env, MATRIX_RUN_ID: runId, MATRIX_REUSE: state.matrixReuse ? "1" : "0" };

    if (String(process.env.MATRIX_BOOTSTRAP_PRESET || "0") === "1") {
      matrixBootstrapOutPath = process.env.MATRIX_BOOTSTRAP_OUT_PRESET || "";
      secretsFile = process.env.MATRIX_SECRETS_FILE_PRESET || "";
      if (!matrixBootstrapOutPath || !secretsFile) {
        throw new Error("MATRIX_BOOTSTRAP_PRESET=1 requires MATRIX_BOOTSTRAP_OUT_PRESET and MATRIX_SECRETS_FILE_PRESET");
      }
      console.error(`[run] using preset matrix bootstrap env: ${matrixBootstrapOutPath}`);
      logStep("bootstrap_matrix", "ok", "preset");
    } else {
      console.error(`[run] bootstrapping matrix (reuse=${runEnv.MATRIX_REUSE})`);
      logStep("bootstrap_matrix", "start");

      const bootstrapScript = path.join(root, "dist-tools", "matrixRun", "bootstrap-matrix.js");
      const res = spawnSync("node", [bootstrapScript], {
        cwd: root,
        env: { ...runEnv, BOOTSTRAP_SECRETS_FILE: secretsFile },
        encoding: "utf8",
        stdio: "pipe",
      });
      const combined = `${res.stdout || ""}${res.stderr || ""}`;
      fs.writeFileSync(state.bootstrapRaw, combined, "utf8");
      if (res.error) throw res.error;
      if ((res.status ?? 1) !== 0) throw new Error(`bootstrap_matrix failed (${res.status})`);

      const envLines = parseEnvLines(combined);
      writeEnvFile(matrixBootstrapOut, envLines);
      try {
        if (fs.existsSync(state.bootstrapRaw)) fs.chmodSync(state.bootstrapRaw, 0o600);
        if (fs.existsSync(secretsFile)) fs.chmodSync(secretsFile, 0o600);
      } catch {}
      logStep("bootstrap_matrix", "ok");
    }

    if (hasDockerContainer("clawlist-synapse")) {
      state.synapseLogPid = spawnToFile("docker", ["logs", "-f", "clawlist-synapse"], path.join(outDir, "synapse.log"));
    }

    const mergedEnv = { ...readEnvFile(matrixBootstrapOutPath), ...readEnvFile(secretsFile) };
    const sellerToken = mergedEnv.SELLER_TOKEN || "";
    const buyerToken = mergedEnv.BUYER_TOKEN || "";
    if (!sellerToken || !buyerToken) {
      logStep("bootstrap_matrix", "error", "missing SELLER_TOKEN/BUYER_TOKEN in secrets.env");
      throw new Error(`[run] ERROR: missing SELLER_TOKEN/BUYER_TOKEN (check ${secretsFile})`);
    }

    const matrixPort = Number(mergedEnv.MATRIX_PORT || process.env.MATRIX_PORT || 18008);
    const homeserver = mergedEnv.HOMESERVER || `http://127.0.0.1:${matrixPort}`;
    const marketRoomId = mergedEnv.ROOM_ID;
    const sellerMxid = mergedEnv.SELLER_MXID;
    const buyerMxid = mergedEnv.BUYER_MXID;
    if (!marketRoomId || !sellerMxid || !buyerMxid) throw new Error("bootstrap did not provide ROOM_ID/SELLER_MXID/BUYER_MXID");

    console.error("[run] validating matrix tokens");
    logStep("validate_tokens", "start");
    for (const [label, token] of [["seller", sellerToken], ["buyer", buyerToken]] as [string, string][]) {
      const res = await fetchJson(`${homeserver}/_matrix/client/v3/account/whoami`, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        logStep("validate_tokens", "error", `${label} token invalid`);
        throw new Error(`[run] ERROR: ${label} token invalid (whoami failed)`);
      }
    }
    logStep("validate_tokens", "ok");

    console.error("[run] validating market room membership");
    logStep("validate_room", "start");
    for (const [label, mxid, token] of [["seller", sellerMxid, sellerToken], ["buyer", buyerMxid, buyerToken]] as [string, string, string][]) {
      const res = await fetchJson(`${homeserver}/_matrix/client/v3/rooms/${marketRoomId}/state/m.room.member/${encodeMxid(mxid)}`, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        logStep("validate_room", "error", `${label} not joined to market room`);
        throw new Error(`[run] ERROR: ${label} not joined to market room ${marketRoomId}`);
      }
    }
    logStep("validate_room", "ok");

    const runShort = (args: string[], extra: any = {}) => run(openclaw, args, { allowFail: extra.allowFail, stdio: extra.stdio || "pipe", timeoutMs: 60000, env: extra.env });

    function ensureProfileReady(profile: string) {
      runShort(["--profile", profile, "config", "set", "gateway.mode", "local"], { allowFail: true });

      const npmRoot = runCapture(npmBin, ["root", "-g"], { allowFail: true }) || "";
      const matrixExt = path.join(npmRoot, "openclaw", "extensions", "matrix");
      const sdkDir = path.join(matrixExt, "node_modules", "@vector-im", "matrix-bot-sdk");
      if (fs.existsSync(matrixExt) && !fs.existsSync(sdkDir)) {
        console.error(`[run] installing deps for built-in matrix plugin (${matrixExt})`);
        const pkgPath = path.join(matrixExt, "package.json");
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
          delete pkg.devDependencies;
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
        }
        const res = spawnSync(npmBin, ["install", "--omit=dev"], { cwd: matrixExt, encoding: "utf8", stdio: "pipe" });
        fs.appendFileSync(path.join(outDir, "npm_install_matrix_builtin.log"), `${res.stdout || ""}${res.stderr || ""}`, "utf8");
      }

      runShort(["--profile", profile, "plugins", "enable", "matrix"], { allowFail: true });
    }

    console.error("[run] preparing profiles");
    logStep("prepare_profiles", "start");
    ensureProfileReady(state.sellerProfile);
    ensureProfileReady(state.buyerProfile);
    logStep("prepare_profiles", "ok");

    function configureMatrix(profile: string, token: string, mxid: string) {
      const rulesRoomId = mergedEnv.RULES_ROOM_ID;
      const groupsExtra = rulesRoomId ? `, '${rulesRoomId}': { allow: true, requireMention: false }` : "";
      const matrixJson = `{ enabled: true, homeserver: '${homeserver}', accessToken: '${token}', userId: '${mxid}', encryption: false, dm: { policy: 'open', allowFrom: ['*'] }, groupPolicy: 'open', groups: { '*': { requireMention: false }, '${marketRoomId}': { allow: true, requireMention: false }${groupsExtra} } }`;
      runShort(["--profile", profile, "config", "set", "--json", "channels.matrix", matrixJson]);
    }

    console.error("[run] configuring matrix channel");
    logStep("configure_matrix", "start");
    configureMatrix(state.sellerProfile, sellerToken, sellerMxid);
    configureMatrix(state.buyerProfile, buyerToken, buyerMxid);
    logStep("configure_matrix", "ok");

    function disableGatewayService(profile: string) {
      runShort(["--profile", profile, "gateway", "stop"], { allowFail: true });
      const systemctl = findOnPath("systemctl");
      if (systemctl) {
        run(systemctl, ["--user", "stop", `openclaw-gateway-${profile}.service`], { allowFail: true, stdio: "pipe" });
        run(systemctl, ["--user", "disable", `openclaw-gateway-${profile}.service`], { allowFail: true, stdio: "pipe" });
      }
    }

    console.error("[run] disabling supervised gateway services (if any)");
    disableGatewayService(state.sellerProfile);
    disableGatewayService(state.buyerProfile);
    const systemctl = findOnPath("systemctl");
    if (systemctl) {
      run(systemctl, ["--user", "stop", "openclaw-gateway.service"], { allowFail: true, stdio: "pipe" });
      run(systemctl, ["--user", "disable", "openclaw-gateway.service"], { allowFail: true, stdio: "pipe" });
    }

    console.error("[run] starting openclaw gateways");
    logStep("start_gateways", "start");
    state.sellerProc = spawnToFile(openclaw, ["--profile", state.sellerProfile, "gateway", "run", "--port", String(sellerGatewayPort), "--token", sellerGatewayToken, "--force", "--compact", "--allow-unconfigured"], path.join(outDir, `gateway_${state.sellerProfile}.log`), { env: { ...process.env, OPENCLAW_GATEWAY_PORT: String(sellerGatewayPort) } });
    state.buyerProc = spawnToFile(openclaw, ["--profile", state.buyerProfile, "gateway", "run", "--port", String(buyerGatewayPort), "--token", buyerGatewayToken, "--force", "--compact", "--allow-unconfigured"], path.join(outDir, `gateway_${state.buyerProfile}.log`), { env: { ...process.env, OPENCLAW_GATEWAY_PORT: String(buyerGatewayPort) } });

    if (!(await waitForPort("127.0.0.1", sellerGatewayPort, 30, 1000))) {
      logStep("start_gateways", "error", "seller gateway not ready");
      throw new Error("seller gateway not ready");
    }
    if (!(await waitForPort("127.0.0.1", buyerGatewayPort, 30, 1000))) {
      logStep("start_gateways", "error", "buyer gateway not ready");
      throw new Error("buyer gateway not ready");
    }
    logStep("start_gateways", "ok");

    console.error("[run] injecting missions");
    logStep("inject_missions", "start");
    const sellerMissionLog = path.join(outDir, `system_event_${state.sellerProfile}.log`);
    const buyerMissionLog = path.join(outDir, `system_event_${state.buyerProfile}.log`);

    const roomAlias = process.env.ROOM_ALIAS || mergedEnv.ROOM_ALIAS || "#market:localhost";
    const rulesAlias = process.env.RULES_ROOM_ALIAS || mergedEnv.RULES_ROOM_ALIAS || "#house-rules:localhost";

    const shared = `HOUSE: You are in a public chat "market" plus private DMs. Before posting anything, read the latest message in the rules room ${rulesAlias} and follow it.\n\nIMPORTANT: This is a fresh run. Ignore any room ids / context from previous runs.`;

    const sellerMission = `MISSION: You are SWITCH_SELLER.\n${shared}\n\nYou are selling a Nintendo Switch. Anchor price: 200EUR. Absolute floor: 150EUR. Do not go below 150EUR.\n\nPUBLIC: Post ONE market message in room ${marketRoomId} (alias ${roomAlias}) advertising the Switch and inviting interested buyers to DM you. Keep it concise (condition, what's included, pickup/shipping, price).\n\nDM: If contacted, negotiate up to 8 turns. Confirm final price + logistics.`;

    const buyerMission = `MISSION: You are SWITCH_BUYER.\n${shared}\n\nYou want to buy a Nintendo Switch. Start offer: 120EUR. Max budget: 150EUR.\n\nPUBLIC: Watch the market room ${marketRoomId} (alias ${roomAlias}).\nDM: If you see a seller offering a Switch, DM them within 1 minute. DM target: ${sellerMxid}. Ask condition/accessories/pickup/shipping. Negotiate up to 8 turns. Confirm final price + logistics.`;

    function injectMission(profile: string, url: string, token: string, text: string, outLog: string): boolean {
      fs.writeFileSync(outLog, "", "utf8");
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        fs.appendFileSync(outLog, `[run] mission inject attempt ${attempt} profile=${profile}\n`, "utf8");
        const env = { ...process.env } as any;
        delete env.OPENCLAW_GATEWAY_PORT;
        const res = spawnSync(openclaw, ["--profile", profile, "system", "event", "--url", url, "--token", token, "--mode", "now", "--text", text], { encoding: "utf8", stdio: "pipe", env, timeout: 60000 });
        fs.appendFileSync(outLog, `${res.stdout || ""}${res.stderr || ""}`, "utf8");
        if (res.status === 0) return true;
      }
      return false;
    }

    if (!injectMission(state.sellerProfile, `ws://127.0.0.1:${sellerGatewayPort}`, sellerGatewayToken, sellerMission, sellerMissionLog)) {
      logStep("inject_missions", "error", "seller mission injection failed");
      throw new Error(`[run] seller mission injection failed; see ${sellerMissionLog}`);
    }
    if (!injectMission(state.buyerProfile, `ws://127.0.0.1:${buyerGatewayPort}`, buyerGatewayToken, buyerMission, buyerMissionLog)) {
      logStep("inject_missions", "error", "buyer mission injection failed");
      throw new Error(`[run] buyer mission injection failed; see ${buyerMissionLog}`);
    }
    logStep("inject_missions", "ok");

    console.error("[run] seeding market listing");
    logStep("seed_market", "start");
    await fetchRetry(`${homeserver}/_matrix/client/v3/rooms/${marketRoomId}/send/m.room.message/txn${Date.now()}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${buyerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "m.text", body: "SEED: (harness) market is open." }),
    }, 5, 1000);
    logStep("seed_market", "ok");

    console.error("[run] verifying market activity");
    logStep("verify_market", "start");
    let marketOk = false;
    const marketDeadline = Date.now() + 120000;
    while (Date.now() < marketDeadline) {
      const res = await fetchJson(`${homeserver}/_matrix/client/v3/rooms/${marketRoomId}/messages?dir=b&limit=30`, { headers: { Authorization: `Bearer ${sellerToken}` } });
      const chunk = Array.isArray((res.json as any)?.chunk) ? (res.json as any).chunk : [];
      marketOk = chunk.some((ev: any) => {
        if (!ev || ev.type !== "m.room.message" || ev.sender !== sellerMxid) return false;
        const body = ev.content && typeof ev.content.body === "string" ? ev.content.body : "";
        if (!body || /^SEED:/i.test(body)) return false;
        return /switch/i.test(body);
      });
      if (marketOk) break;
      await sleep(2000);
    }
    if (!marketOk) {
      logStep("verify_market", "error", "no seller market message mentioning Switch found within 120s");
      throw new Error("[run] verify failed: seller did not post a market message mentioning Switch within 120s");
    }
    logStep("verify_market", "ok");

    console.error("[run] verifying DM activity");
    logStep("verify_dm", "start");
    let dmOk = false;
    const dmDeadline = Date.now() + 90000;
    while (Date.now() < dmDeadline) {
      const res = await fetchJson(`${homeserver}/_matrix/client/v3/joined_rooms`, { headers: { Authorization: `Bearer ${sellerToken}` } });
      const count = Array.isArray((res.json as any)?.joined_rooms) ? (res.json as any).joined_rooms.length : 0;
      if (count >= 2) {
        dmOk = true;
        break;
      }
      await sleep(2000);
    }
    if (!dmOk) {
      logStep("verify_dm", "error", "no DM room opened within 90s");
      throw new Error("[run] verify failed: no DM room opened within 90s");
    }
    logStep("verify_dm", "ok");

    const runMinutes = Number(process.env.RUN_MINUTES || 5);
    console.error(`[run] running for ${runMinutes} minutes`);
    await sleep(runMinutes * 60 * 1000);

    console.error("[run] exporting transcripts");
    logStep("export_transcripts", "start");
    const metaPath = path.join(outDir, "meta.json");
    fs.writeFileSync(metaPath, JSON.stringify({
      homeserver,
      marketRoomId,
      seller: { profile: state.sellerProfile, mxid: sellerMxid },
      buyer: { profile: state.buyerProfile, mxid: buyerMxid },
      runMinutes,
    }, null, 2) + "\n", "utf8");

    run("node", [path.join(root, "dist-tools", "matrixRun", "export-transcripts.js"), outDir, metaPath], { cwd: root });
    logStep("export_transcripts", "ok");

    console.error(`[run] done. outputs in ${outDir}`);
    console.error(`[run] run id: ${runId}`);
  } catch (err) {
    dumpLogs();
    throw err;
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error((err as Error)?.message || String(err));
  process.exit(1);
});
