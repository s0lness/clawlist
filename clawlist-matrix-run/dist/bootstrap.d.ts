export interface BootstrapResult {
    sellerMxid: string;
    sellerToken: string;
    buyerMxid: string;
    buyerToken: string;
    roomId: string;
    roomAlias: string;
    homeserver: string;
}
/** Bootstrap Matrix users and market room */
export declare function bootstrap(rootDir: string): Promise<BootstrapResult>;
//# sourceMappingURL=bootstrap.d.ts.map