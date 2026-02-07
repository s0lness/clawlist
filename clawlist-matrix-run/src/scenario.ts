import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { log } from './common.js';

export interface Scenario {
  name: string;
  item: string;
  marketRoomAlias: string;
  seller: {
    profile: string;
    anchorPrice: number;
    floorPrice: number;
  };
  buyer: {
    profile: string;
    startOffer: number;
    ceilingPrice: number;
  };
  durationSec: number;
  seed: {
    bodyTemplate: string;
  };
}

/** Load a scenario JSON file */
export async function loadScenario(rootDir: string, scenarioName: string): Promise<Scenario> {
  const scenarioPath = join(rootDir, 'scenarios', `${scenarioName}.json`);

  log('scenario', `loading ${scenarioPath}`);

  const content = await readFile(scenarioPath, 'utf-8');
  const scenario: Scenario = JSON.parse(content);

  // Validate required fields
  if (!scenario.seller?.profile || !scenario.buyer?.profile) {
    throw new Error(`Invalid scenario: missing seller or buyer profile`);
  }

  return scenario;
}

/** Generate seller mission from scenario */
export function generateSellerMission(scenario: Scenario): string {
  return `SELLING: ${scenario.item}

You are selling this item on #market:localhost.

Your strategy:
- Asking price: ${scenario.seller.anchorPrice}€
- Floor price (minimum acceptable): ${scenario.seller.floorPrice}€
- Be willing to negotiate, but don't go below your floor
- Answer questions about condition, accessories, pickup location
- If you agree on a price, confirm: "DEAL: [price]€. When can you pick it up?"

Start by waiting for someone to DM you after seeing your market listing.
Be concise and natural in your responses.`;
}

/** Generate buyer mission from scenario */
export function generateBuyerMission(scenario: Scenario): string {
  return `BUYING: ${scenario.item}

You saw a listing for this item on #market:localhost and you're interested.

Your strategy:
- Start offer: ${scenario.buyer.startOffer}€
- Maximum you'll pay: ${scenario.buyer.ceilingPrice}€
- Ask questions about condition, accessories, pickup location
- Negotiate to get the best price within your budget
- If you agree on a price, confirm: "DEAL: [price]€. Let me know your pickup time."

DM the seller now to start negotiating.
Be concise and natural in your responses.`;
}

/** Generate market listing from scenario */
export function generateMarketListing(scenario: Scenario, runId: string): string {
  return scenario.seed.bodyTemplate.replace('{RUN_ID}', runId);
}
