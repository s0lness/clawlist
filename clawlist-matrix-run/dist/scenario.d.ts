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
export declare function loadScenario(rootDir: string, scenarioName: string): Promise<Scenario>;
/** Generate seller mission from scenario */
export declare function generateSellerMission(scenario: Scenario): string;
/** Generate buyer mission from scenario */
export declare function generateBuyerMission(scenario: Scenario): string;
/** Generate market listing from scenario */
export declare function generateMarketListing(scenario: Scenario, runId: string): string;
//# sourceMappingURL=scenario.d.ts.map