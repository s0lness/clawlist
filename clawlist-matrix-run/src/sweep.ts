#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { log, logError } from './common.js';
import { readFile } from 'node:fs/promises';

const ROOT_DIR = process.cwd();

interface RunResult {
  runId: string;
  result: string;
  dealReached: boolean;
  finalPrice: number | null;
  violations: string[];
  offerCount: number;
  tFirstDmSec: number | null;
  humanIntervention: boolean;
}

async function runScenario(scenarioName: string, runId: string, durationSec: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    log('sweep', `starting run ${runId}`);

    const proc = spawn('node', ['dist/run-scenario.js', scenarioName], {
      env: {
        ...process.env,
        RUN_ID: runId,
        DURATION_SEC: durationSec.toString(),
      },
      stdio: 'inherit',
    });

    proc.on('close', async (code) => {
      if (code === 0) {
        try {
          const summaryPath = join(ROOT_DIR, 'runs', runId, 'out', 'summary.json');
          const summary = JSON.parse(await readFile(summaryPath, 'utf-8'));

          resolve({
            runId,
            result: summary.result,
            dealReached: summary.dealReached,
            finalPrice: summary.finalPrice,
            violations: summary.violations,
            offerCount: summary.metrics.offerCount,
            tFirstDmSec: summary.metrics.tFirstDmSec,
            humanIntervention: summary.metrics.humanIntervention,
          });
        } catch (err: any) {
          reject(new Error(`Failed to read summary for ${runId}: ${err.message}`));
        }
      } else {
        reject(new Error(`Run ${runId} exited with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

async function main() {
  const scenarioName = process.argv[2];
  const count = parseInt(process.argv[3] || '10');

  if (!scenarioName) {
    console.error('usage: sweep.ts <scenarioName> [count]');
    process.exit(2);
  }

  const sweepId = `sweep_${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '_').substring(0, 15)}`;
  const sweepDir = join(ROOT_DIR, 'runs', sweepId);
  await mkdir(sweepDir, { recursive: true });

  log('sweep', `running ${count} scenarios: ${scenarioName}`);
  log('sweep', `sweep id: ${sweepId}`);

  const results: RunResult[] = [];

  for (let i = 1; i <= count; i++) {
    const runId = `${sweepId}_${i}`;

    try {
      const result = await runScenario(scenarioName, runId, 120);
      results.push(result);
      log('sweep', `completed ${i}/${count}: ${result.result}`);
    } catch (err: any) {
      logError('sweep', `run ${i}/${count} failed: ${err.message}`);
      results.push({
        runId,
        result: 'error',
        dealReached: false,
        finalPrice: null,
        violations: ['SWEEP_ERROR'],
        offerCount: 0,
        tFirstDmSec: null,
        humanIntervention: false,
      });
    }
  }

  // Calculate aggregate stats
  const passCount = results.filter((r) => r.result === 'pass').length;
  const noDealCount = results.filter((r) => r.result === 'no_deal').length;
  const failCount = results.filter((r) => r.result === 'fail' || r.result === 'error').length;

  const dealPrices = results
    .filter((r) => r.dealReached && r.finalPrice !== null)
    .map((r) => r.finalPrice!);

  const avgPrice = dealPrices.length ? dealPrices.reduce((a, b) => a + b, 0) / dealPrices.length : null;

  const aggregate = {
    sweepId,
    scenario: scenarioName,
    totalRuns: count,
    passCount,
    noDealCount,
    failCount,
    successRate: (passCount / count) * 100,
    avgFinalPrice: avgPrice,
    results,
  };

  // Write aggregate
  const aggregatePath = join(sweepDir, 'aggregate.json');
  await writeFile(aggregatePath, JSON.stringify(aggregate, null, 2));

  log('sweep', `✓ sweep complete: ${passCount}/${count} passed (${aggregate.successRate.toFixed(1)}%)`);
  log('sweep', `aggregate: ${aggregatePath}`);

  if (avgPrice !== null) {
    log('sweep', `average final price: ${avgPrice.toFixed(2)}€`);
  }
}

main().catch((err) => {
  logError('sweep', err.message);
  console.error(err);
  process.exit(1);
});
