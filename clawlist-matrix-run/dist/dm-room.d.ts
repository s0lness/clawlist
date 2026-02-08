export interface DmRoomMeta {
    runId?: string;
    dmRoomId: string;
    seller: {
        mxid: string;
    };
    buyer: {
        mxid: string;
    };
}
/** Create a per-run DM room between seller and buyer */
export declare function createDmRoom(homeserver: string, sellerMxid: string, sellerToken: string, buyerMxid: string, buyerToken: string, runId: string, outDir: string): Promise<DmRoomMeta>;
/** Load DM room meta from a run directory */
export declare function loadDmRoomMeta(outDir: string): Promise<DmRoomMeta>;
//# sourceMappingURL=dm-room.d.ts.map