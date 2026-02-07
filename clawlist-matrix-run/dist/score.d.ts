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
/** Score a run based on exported transcripts */
export declare function scoreRun(outDir: string, scenario?: Scenario | null): Promise<ScoreSummary>;
export {};
//# sourceMappingURL=score.d.ts.map