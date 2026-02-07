import { retry, log, logError } from './common.js';

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
export function createClient(homeserver: string, accessToken?: string): MatrixClient {
  return { homeserver, accessToken };
}

/** HTTP request helper */
async function request(
  method: string,
  url: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<any> {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

/** Login with password */
export async function login(
  client: MatrixClient,
  username: string,
  password: string
): Promise<LoginResult> {
  log('matrix-api', `logging in as ${username}`);
  const result = await retry<LoginResult>(
    () =>
      request('POST', `${client.homeserver}/_matrix/client/v3/login`, {
        type: 'm.login.password',
        user: username,
        password,
      }),
    { maxAttempts: 3, delayMs: 2000 }
  );

  client.userId = result.user_id;
  client.accessToken = result.access_token;
  return result;
}

/** Register a new user */
export async function register(
  client: MatrixClient,
  username: string,
  password: string
): Promise<LoginResult> {
  log('matrix-api', `registering user ${username}`);
  try {
    const result = await request('POST', `${client.homeserver}/_matrix/client/v3/register`, {
      username,
      password,
      auth: { type: 'm.login.dummy' },
    });
    client.userId = result.user_id;
    client.accessToken = result.access_token;
    return result;
  } catch (err: any) {
    // If user already exists, try to login
    if (err.message.includes('400')) {
      return login(client, username, password);
    }
    throw err;
  }
}

/** Create a room */
export async function createRoom(
  client: MatrixClient,
  opts: {
    name?: string;
    alias?: string;
    topic?: string;
    invite?: string[];
    isDirect?: boolean;
    preset?: 'private_chat' | 'trusted_private_chat' | 'public_chat';
    visibility?: 'public' | 'private';
  } = {}
): Promise<CreateRoomResult> {
  if (!client.accessToken) throw new Error('Not logged in');

  log('matrix-api', `creating room: ${opts.name || opts.alias || '(unnamed)'}`);

  const body: any = {
    preset: opts.preset || 'trusted_private_chat',
    visibility: opts.visibility || 'private',
  };

  if (opts.name) body.name = opts.name;
  if (opts.topic) body.topic = opts.topic;
  if (opts.alias) body.room_alias_name = opts.alias.replace(/^#/, '').replace(/:.*$/, '');
  if (opts.invite) body.invite = opts.invite;
  if (opts.isDirect) body.is_direct = true;

  return request('POST', `${client.homeserver}/_matrix/client/v3/createRoom`, body, {
    Authorization: `Bearer ${client.accessToken}`,
  });
}

/** Join a room */
export async function joinRoom(
  client: MatrixClient,
  roomIdOrAlias: string
): Promise<{ room_id: string }> {
  if (!client.accessToken) throw new Error('Not logged in');

  log('matrix-api', `joining room: ${roomIdOrAlias}`);

  const encoded = encodeURIComponent(roomIdOrAlias);
  return request('POST', `${client.homeserver}/_matrix/client/v3/join/${encoded}`, {}, {
    Authorization: `Bearer ${client.accessToken}`,
  });
}

/** Send a message to a room */
export async function sendMessage(
  client: MatrixClient,
  roomId: string,
  message: string
): Promise<{ event_id: string }> {
  if (!client.accessToken) throw new Error('Not logged in');

  log('matrix-api', `sending message to ${roomId}: ${message.substring(0, 50)}...`);

  const txnId = Date.now().toString();
  return request(
    'PUT',
    `${client.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
      roomId
    )}/send/m.room.message/${txnId}`,
    {
      msgtype: 'm.text',
      body: message,
    },
    {
      Authorization: `Bearer ${client.accessToken}`,
    }
  );
}

/** Get room messages */
export async function getMessages(
  client: MatrixClient,
  roomId: string,
  opts: { limit?: number; from?: string; dir?: 'b' | 'f' } = {}
): Promise<{ chunk: RoomEvent[]; start: string; end: string }> {
  if (!client.accessToken) throw new Error('Not logged in');

  const params = new URLSearchParams({
    dir: opts.dir || 'b',
    limit: (opts.limit || 100).toString(),
  });
  if (opts.from) params.set('from', opts.from);

  const url = `${client.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
    roomId
  )}/messages?${params}`;

  return request('GET', url, undefined, {
    Authorization: `Bearer ${client.accessToken}`,
  });
}

/** Set power level for a user */
export async function setPowerLevel(
  client: MatrixClient,
  roomId: string,
  userId: string,
  level: number
): Promise<void> {
  if (!client.accessToken) throw new Error('Not logged in');

  log('matrix-api', `setting power level for ${userId} in ${roomId} to ${level}`);

  // Get current power levels
  const currentPL = await request(
    'GET',
    `${client.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
      roomId
    )}/state/m.room.power_levels`,
    undefined,
    {
      Authorization: `Bearer ${client.accessToken}`,
    }
  );

  // Update
  currentPL.users = currentPL.users || {};
  currentPL.users[userId] = Math.max(currentPL.users[userId] || 0, level);

  // Set
  await request(
    'PUT',
    `${client.homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(
      roomId
    )}/state/m.room.power_levels`,
    currentPL,
    {
      Authorization: `Bearer ${client.accessToken}`,
    }
  );
}

/** Set room visibility in directory */
export async function setRoomVisibility(
  client: MatrixClient,
  roomId: string,
  visibility: 'public' | 'private'
): Promise<void> {
  if (!client.accessToken) throw new Error('Not logged in');

  log('matrix-api', `setting room ${roomId} visibility to ${visibility}`);

  await request(
    'PUT',
    `${client.homeserver}/_matrix/client/v3/directory/list/room/${encodeURIComponent(roomId)}`,
    { visibility },
    {
      Authorization: `Bearer ${client.accessToken}`,
    }
  );
}

/** Check if homeserver is reachable */
export async function checkServer(homeserver: string): Promise<boolean> {
  try {
    await request('GET', `${homeserver}/_matrix/client/versions`, undefined);
    return true;
  } catch {
    return false;
  }
}
