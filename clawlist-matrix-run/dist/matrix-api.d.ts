export interface MatrixClient {
    homeserver: string;
    userId?: string;
    accessToken?: string;
}
export interface LoginResult {
    access_token: string;
    user_id: string;
    device_id: string;
}
export interface CreateRoomResult {
    room_id: string;
}
export interface RoomEvent {
    type: string;
    sender: string;
    content: any;
    origin_server_ts?: number;
    event_id?: string;
}
/** Create a Matrix client */
export declare function createClient(homeserver: string, accessToken?: string): MatrixClient;
/** Login with password */
export declare function login(client: MatrixClient, username: string, password: string): Promise<LoginResult>;
/** Register a new user */
export declare function register(client: MatrixClient, username: string, password: string): Promise<LoginResult>;
/** Create a room */
export declare function createRoom(client: MatrixClient, opts?: {
    name?: string;
    alias?: string;
    topic?: string;
    invite?: string[];
    isDirect?: boolean;
    preset?: 'private_chat' | 'trusted_private_chat' | 'public_chat';
    visibility?: 'public' | 'private';
}): Promise<CreateRoomResult>;
/** Join a room */
export declare function joinRoom(client: MatrixClient, roomIdOrAlias: string): Promise<{
    room_id: string;
}>;
/** Send a message to a room */
export declare function sendMessage(client: MatrixClient, roomId: string, message: string): Promise<{
    event_id: string;
}>;
/** Get room messages */
export declare function getMessages(client: MatrixClient, roomId: string, opts?: {
    limit?: number;
    from?: string;
    dir?: 'b' | 'f';
}): Promise<{
    chunk: RoomEvent[];
    start: string;
    end: string;
}>;
/** Set power level for a user */
export declare function setPowerLevel(client: MatrixClient, roomId: string, userId: string, level: number): Promise<void>;
/** Set room visibility in directory */
export declare function setRoomVisibility(client: MatrixClient, roomId: string, visibility: 'public' | 'private'): Promise<void>;
/** Check if homeserver is reachable */
export declare function checkServer(homeserver: string): Promise<boolean>;
//# sourceMappingURL=matrix-api.d.ts.map