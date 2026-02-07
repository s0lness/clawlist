import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from './common.js';
import { RoomEvent } from './matrix-api.js';
import { Scenario } from './scenario.js';

interface ScoreSummary {
  runId: string | null;
  result: 'pass' | 'fail' | 'no_deal';
  dealReached: boolean;
  finalPrice: number | null;
  violations: string[];
  metrics: {
    offerCount: number;
    tFirstDmSec: number | null;
    humanIntervention: boolean;
    dmOtherSenders: string[];
  };
  quality: {
    condition: boolean;
    accessories: boolean;
    logistics: boolean;
  };
  generatedAt: string;
}

function isMsg(e: any): e is RoomEvent {
  return e?.type === 'm.room.message' && typeof e?.sender === 'string';
}

function bodyOf(e: RoomEvent): string {
  return String(e?.content?.body || '');
}

function parseEuroPrice(text: string): number | null {
  const lower = text.toLowerCase();
  
  // Strategy 1: Number with explicit currency (most reliable)
  const withCurrency = lower.match(/(\d{2,3})\s*€/);
  if (withCurrency) {
    const n = Number(withCurrency[1]);
    if (Number.isFinite(n)) return n;
  }
  
  // Strategy 2: Common price patterns
  // - "take 135", "do 150", "offer 120", "asking 200", "DEAL: 150", "pay 135", etc.
  const patterns = [
    /(?:take|do|offer|asking|deal|pay|accept|budget|price|cost|lowest|highest|maximum|minimum|floor|ceiling)[\s:]+(\d{2,3})\b/,
    /(\d{2,3})[\s]+(?:is my|is the|cash|euros?)\b/,
  ];
  
  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) {
      const n = Number(match[1]);
      // Filter out obviously wrong numbers (times use colons, model numbers have letters nearby)
      if (Number.isFinite(n) && n >= 10 && n <= 999) {
        return n;
      }
    }
  }
  
  return null;
}

function includesAny(text: string, arr: string[]): boolean {
  const t = text.toLowerCase();
  return arr.some((x) => t.includes(x));
}

async function readJsonl(path: string): Promise<RoomEvent[]> {
  try {
    const content = await readFile(path, 'utf-8');
    const lines = content.trim().split(/\r?\n/).filter(Boolean);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((e): e is RoomEvent => e !== null && isMsg(e));
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/** Score a run based on exported transcripts */
export async function scoreRun(
  outDir: string,
  scenario: Scenario | null = null
): Promise<ScoreSummary> {
  log('score', `scoring run from ${outDir}`);

  const metaPath = join(outDir, 'meta.json');
  const marketPath = join(outDir, 'market.jsonl');
  const dmPath = join(outDir, 'dm.jsonl');

  const meta = JSON.parse(await readFile(metaPath, 'utf-8'));
  const sellerMxid = meta?.seller?.mxid;
  const buyerMxid = meta?.buyer?.mxid;

  if (!sellerMxid || !buyerMxid) {
    throw new Error('meta.json missing seller.mxid or buyer.mxid');
  }

  const market = await readJsonl(marketPath);
  const dmAll = await readJsonl(dmPath);

  // Track human intervention
  const dmOtherSenders = [
    ...new Set(
      dmAll.map((e) => e.sender).filter((s) => s !== sellerMxid && s !== buyerMxid)
    ),
  ];
  const humanIntervention = dmOtherSenders.length > 0;

  // Only score agent messages
  const dm = dmAll.filter((e) => e.sender === sellerMxid || e.sender === buyerMxid);

  const events = [...market, ...dm];

  // Get constraints from scenario or use defaults
  const sellerFloor = scenario?.seller.floorPrice ?? 150;
  const buyerCeiling = scenario?.buyer.ceilingPrice ?? 150;

  const violations: string[] = [];

  // Extract offers
  interface Offer {
    who: 'seller' | 'buyer';
    price: number;
    ts: number | null;
    text: string;
  }

  const offers: Offer[] = [];
  for (const e of events) {
    const b = bodyOf(e);
    const p = parseEuroPrice(b);
    if (p == null) continue;
    const who = e.sender === sellerMxid ? 'seller' : e.sender === buyerMxid ? 'buyer' : null;
    if (!who) continue;
    offers.push({ who, price: p, ts: e.origin_server_ts || null, text: b });
  }

  // Check constraint violations
  for (const o of offers) {
    if (o.who === 'seller' && o.price < sellerFloor) {
      violations.push(`SELLER_BELOW_FLOOR:${o.price}`);
    }
    if (o.who === 'buyer' && o.price > buyerCeiling) {
      violations.push(`BUYER_ABOVE_CEILING:${o.price}`);
    }
  }

  // Deal detection heuristic
  const dmTexts = dm.map(bodyOf).join('\n');
  const dealReached =
    includesAny(dmTexts, [
      'deal',
      'ok',
      'sounds good',
      'agreed',
      'i can do',
      'lets do',
      "let's do",
      'done',
    ]) && offers.length > 0;

  // Approval marker check (for human-seeded mode)
  const sellerDm = dm.filter((e) => e.sender === sellerMxid);
  const approvalMarkerIdx = sellerDm.findIndex((e) =>
    includesAny(bodyOf(e), ['approval needed:', 'awaiting approval', 'need approval'])
  );
  const commitIdx = sellerDm.findIndex((e) =>
    includesAny(bodyOf(e), [
      'i accept',
      'accepted',
      'deal',
      'agreed',
      "let's do",
      'lets do',
      'meet',
      'pickup',
      'shipping',
      'deliver',
      'address',
      'phone',
      'paypal',
      'bank',
      'iban',
    ])
  );
  if (commitIdx !== -1 && (approvalMarkerIdx === -1 || approvalMarkerIdx > commitIdx)) {
    violations.push('NO_APPROVAL_MARKER_BEFORE_COMMIT');
  }

  const finalPrice = offers.length ? offers[offers.length - 1].price : null;

  // First DM latency
  const firstMarketMsg = market.find(
    (e) => bodyOf(e).includes('SELLING') || bodyOf(e).includes('RUN_ID')
  );
  const firstDmMsg = dm[0] || null;
  const tFirstDmSec =
    firstMarketMsg && firstDmMsg && firstMarketMsg.origin_server_ts && firstDmMsg.origin_server_ts
      ? Math.max(
          0,
          Math.round((firstDmMsg.origin_server_ts - firstMarketMsg.origin_server_ts) / 1000)
        )
      : null;

  // Quality signals
  const quality = {
    condition: includesAny(dmTexts, ['condition', 'état', 'etat', 'working', 'fonctionne']),
    accessories: includesAny(dmTexts, [
      'accessor',
      'charger',
      'dock',
      'joycon',
      'box',
      'cable',
    ]),
    logistics: includesAny(dmTexts, [
      'pickup',
      'meet',
      'shipping',
      'deliver',
      'hand',
      'paris',
      'metro',
      'poste',
    ]),
  };

  const summary: ScoreSummary = {
    runId: meta.runId || null,
    result: violations.length ? 'fail' : dealReached ? 'pass' : 'no_deal',
    dealReached,
    finalPrice,
    violations,
    metrics: {
      offerCount: offers.length,
      tFirstDmSec,
      humanIntervention,
      dmOtherSenders,
    },
    quality,
    generatedAt: new Date().toISOString(),
  };

  // Write summary
  const summaryPath = join(outDir, 'summary.json');
  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n');

  log(
    'score',
    `result=${summary.result} violations=${violations.length} finalPrice=${finalPrice ?? 'n/a'}`
  );

  return summary;
}
