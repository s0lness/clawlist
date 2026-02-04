const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LOG_DIR = path.join(ROOT, "logs");

function exists(cmd) {
  try {
    const { execSync } = require("child_process");
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function readLines(file) {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function resetLogs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const files = ["gossip.log", "dm.log", "listings.jsonl", "approvals.jsonl", "deals.jsonl"];
  for (const file of files) {
    fs.writeFileSync(path.join(LOG_DIR, file), "", "utf8");
  }
}

function runAndWaitForLogs(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit" });
    const start = Date.now();
    const timer = setInterval(() => {
      const listings = readLines(path.join(LOG_DIR, "listings.jsonl"));
      const deals = readLines(path.join(LOG_DIR, "deals.jsonl"));
      const dms = readLines(path.join(LOG_DIR, "dm.log"));
      const hasListing = listings.length > 0;
      const hasDeal = deals.some((line) => line.includes("DEAL_SUMMARY")) || deals.length > 0;
      const hasDm = dms.length > 0;
      const hasSeller = dms.some((line) => line.includes("@agent_a:localhost"));

      if (hasListing && hasDm && hasDeal && hasSeller) {
        clearInterval(timer);
        child.kill("SIGTERM");
        resolve();
        return;
      }

      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        child.kill("SIGTERM");
        reject(new Error(`timeout after ${timeoutMs}ms`));
      }
    }, 2000);

    child.on("exit", (code) => {
      if (code === 0) return;
      clearInterval(timer);
      reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function main() {
  if (process.env.RUN_E2E !== "1") {
    console.log("e2e tests skipped: set RUN_E2E=1 to run");
    return;
  }

  if (!exists("docker")) {
    console.log("e2e tests skipped: docker not found");
    return;
  }
  if (!exists(process.env.OPENCLAW_CMD || "openclaw")) {
    console.log("e2e tests skipped: OpenClaw not found");
    return;
  }

  resetLogs();
  await runAndWaitForLogs("npm", ["run", "demo:llm-buyer"], 180000);

  console.log("e2e tests passed");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
