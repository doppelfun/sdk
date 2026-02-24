/**
 * Unified Doppel agent client: single entry point for session, document CRUD,
 * Agent WebSocket (connect, move, chat, join), and chat history.
 */

import { fetchJson, normalizeBaseUrl } from "./utils.js";
import { getAgentWsUrl, AGENT_WS_DEFAULT_PATH } from "./agentWs.js";
import type {
  AgentWsInputMessage,
  AgentWsChatMessage,
  AgentWsJoinMessage,
  AgentWsEmoteMessage,
} from "./agentWs.js";
import type { ChatHistoryMessage, GetChatHistoryOptions, GetChatHistoryResult } from "./chat.js";

const CHAT_LIMIT_MIN = 1;
const CHAT_LIMIT_MAX = 500;
const CHAT_LIMIT_DEFAULT = 100;

/** Occupant type from GET /api/agent/occupants. */
export type OccupantType = "observer" | "user" | "agent";

export type Occupant = {
  clientId: string;
  userId: string;
  username: string;
  type: OccupantType;
  /** Present when the occupant is in the same region as the requesting agent. */
  position?: { x: number; y: number; z: number };
};

const DEFAULT_RECONNECT_BACKOFF_MS = 2000;
const DEFAULT_RECONNECT_MAX_BACKOFF_MS = 60000;

export type DoppelClientOptions = {
  /** Engine base URL (e.g. https://your-app.railway.app or http://localhost:2567). */
  engineUrl: string;
  /** Returns the current JWT (hub-issued). Can be sync or async for refresh. */
  getJwt: () => string | Promise<string>;
  /** Optional x-api-key for HTTP requests. */
  apiKey?: string;
  /** WebSocket constructor (required in Node; browser can omit and use global WebSocket). */
  WebSocket?: typeof WebSocket;
  /** Agent WebSocket path (default /connect). */
  agentWsPath?: string;
  /** Enable automatic reconnect on close (default true). */
  reconnect?: boolean;
  /** Initial backoff in ms before first reconnect (default 2000). */
  reconnectBackoffMs?: number;
  /** Max backoff in ms between reconnect attempts (default 60000). */
  reconnectMaxBackoffMs?: number;
  /** Called before each reconnect attempt (attempt is 1-based). */
  onReconnecting?: (attempt: number) => void;
};

function authHeaders(getToken: () => string | Promise<string>, apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  return headers;
}

function bearerHeaders(sessionToken: string, apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${sessionToken}`,
  };
  if (apiKey) headers["x-api-key"] = apiKey;
  return headers;
}

/**
 * Single entry point: create a client that can connect, get/refresh session,
 * CRUD documents, and send move/chat over the Agent WebSocket.
 */
export function createClient(options: DoppelClientOptions): DoppelClient {
  return new DoppelClient(options);
}

export class DoppelClient {
  private readonly base: string;
  private readonly getJwt: () => string | Promise<string>;
  private readonly apiKey: string | undefined;
  private readonly WsConstructor: typeof WebSocket | undefined;
  private readonly agentWsPath: string;
  private readonly reconnect: boolean;
  private readonly reconnectBackoffMs: number;
  private readonly reconnectMaxBackoffMs: number;
  private readonly onReconnecting?: (attempt: number) => void;

  /** Cached session token (JWT session). */
  private sessionToken: string | null = null;

  /** Current WebSocket; set after connect(). */
  private ws: WebSocket | null = null;

  /** Handlers for server message types (e.g. "authenticated", "chat"). Call onMessage() before connect(). */
  private readonly messageHandlers = new Map<string, Array<(payload: unknown) => void>>();

  private disconnectRequested = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  constructor(options: DoppelClientOptions) {
    this.base = normalizeBaseUrl(options.engineUrl);
    this.getJwt = options.getJwt;
    this.apiKey = options.apiKey;
    this.WsConstructor = options.WebSocket ?? (typeof WebSocket !== "undefined" ? WebSocket : undefined);
    this.agentWsPath = options.agentWsPath ?? AGENT_WS_DEFAULT_PATH;
    this.reconnect = options.reconnect !== false;
    this.reconnectBackoffMs = options.reconnectBackoffMs ?? DEFAULT_RECONNECT_BACKOFF_MS;
    this.reconnectMaxBackoffMs = options.reconnectMaxBackoffMs ?? DEFAULT_RECONNECT_MAX_BACKOFF_MS;
    this.onReconnecting = options.onReconnecting;
  }

  /**
   * Get or refresh session token (POST /session with JWT). Cached until next call.
   */
  async getSessionToken(): Promise<string> {
    const jwt = await Promise.resolve(this.getJwt());
    const headers = authHeaders(this.getJwt, this.apiKey);
    const data = await fetchJson<{ sessionToken: string }>(
      `${this.base}/session`,
      { method: "POST", headers, body: JSON.stringify({ token: jwt }) },
      "session"
    );
    this.sessionToken = data.sessionToken;
    return data.sessionToken;
  }

  /**
   * Build the Agent WebSocket URL with current JWT. Use this if you manage the socket yourself.
   */
  async getAgentWsUrl(): Promise<string> {
    const jwt = await Promise.resolve(this.getJwt());
    return getAgentWsUrl(this.base, this.agentWsPath, jwt);
  }

  /**
   * Register a handler for a server message type (e.g. "authenticated", "chat"). Call before connect().
   */
  onMessage(type: string, handler: (payload: unknown) => void): void {
    let list = this.messageHandlers.get(type);
    if (!list) {
      list = [];
      this.messageHandlers.set(type, list);
    }
    list.push(handler);
  }

  private emitMessage(type: string, payload: unknown): void {
    const list = this.messageHandlers.get(type);
    if (list) for (const fn of list) fn(payload);
  }

  /**
   * Connect to the Agent WebSocket and wait for `authenticated`. Uses options.WebSocket (or global in browser).
   * After this, sendInput, sendChat, sendJoin can be used. Incoming messages are dispatched to onMessage() handlers.
   * If reconnect is enabled (default), the client will automatically reconnect on close and emit "authenticated" again.
   */
  async connect(): Promise<void> {
    this.disconnectRequested = false;
    return this.doConnect();
  }

  /**
   * Internal: open socket, wait for authenticated, attach close handler for reconnect.
   */
  private async doConnect(): Promise<void> {
    const Ws = this.WsConstructor;
    if (!Ws) {
      throw new Error("DoppelClient: pass options.WebSocket (e.g. from 'ws' in Node) or use in a browser with global WebSocket");
    }
    const url = await this.getAgentWsUrl();
    return new Promise((resolve, reject) => {
      const socket = new Ws(url) as WebSocket & { on?: (ev: string, fn: (e: unknown) => void) => void; off?: (ev: string, fn: (e: unknown) => void) => void };
      this.ws = socket;

      const onMessage = (raw: unknown) => {
        const text =
          typeof raw === "string"
            ? raw
            : new TextDecoder().decode(
                raw instanceof Uint8Array ? raw : new Uint8Array((raw as ArrayBuffer) || [])
              );
        let msg: { type?: string; [k: string]: unknown };
        try {
          msg = JSON.parse(text) as { type?: string; [k: string]: unknown };
        } catch {
          return;
        }
        const type = typeof msg.type === "string" ? msg.type : "";
        if (type === "authenticated") {
          removeErrorListener();
          this.reconnectAttempt = 0;
          resolve();
          this.emitMessage("authenticated", msg);
          return;
        }
        if (type === "error") {
          removeErrorListener();
          reject(new Error(`Agent WS error: ${String((msg as { code?: string; error?: string }).code ?? "")} ${String((msg as { error?: string }).error ?? "")}`));
          return;
        }
        this.emitMessage(type, msg);
      };

      const onError = (err: unknown) => {
        removeErrorListener();
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      const scheduleReconnect = (): void => {
        if (this.disconnectRequested || !this.reconnect) return;
        this.reconnectAttempt++;
        const delay = Math.min(
          this.reconnectBackoffMs * Math.pow(2, this.reconnectAttempt - 1),
          this.reconnectMaxBackoffMs
        );
        this.onReconnecting?.(this.reconnectAttempt);
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          if (this.disconnectRequested) return;
          this.doConnect().catch(() => {
            this.ws = null;
            scheduleReconnect();
          });
        }, delay);
      };

      const onClose = (): void => {
        this.ws = null;
        removeErrorListener();
        scheduleReconnect();
      };

      const removeErrorListener = (): void => {
        if (typeof socket.off === "function") {
          socket.off("error", onError);
          socket.off("close", onClose);
        } else {
          socket.removeEventListener("error", onError as EventListener);
          socket.removeEventListener("close", onClose as EventListener);
        }
      };

      if (typeof socket.on === "function") {
        socket.on("message", onMessage);
        socket.on("error", onError);
        socket.on("close", onClose);
      } else {
        socket.addEventListener("message", onMessage as EventListener);
        socket.addEventListener("error", onError as EventListener);
        socket.addEventListener("close", onClose as EventListener);
      }
    });
  }

  /** Send movement (input) over the connected WebSocket. No-op if not connected. */
  sendInput(params: { moveX?: number; moveZ?: number; sprint?: boolean; jump?: boolean }): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    const msg: AgentWsInputMessage = {
      type: "input",
      moveX: params.moveX ?? 0,
      moveZ: params.moveZ ?? 0,
      sprint: params.sprint ?? false,
      jump: params.jump ?? false,
    };
    this.ws.send(JSON.stringify(msg));
  }

  /** Send a chat message over the connected WebSocket. No-op if not connected. */
  sendChat(text: string): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    const msg: AgentWsChatMessage = { type: "chat", text };
    this.ws.send(JSON.stringify(msg));
  }

  /** Request to join another region over the connected WebSocket. No-op if not connected. */
  sendJoin(regionId: string): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    const msg: AgentWsJoinMessage = { type: "join", regionId };
    this.ws.send(JSON.stringify(msg));
  }

  /** Send an emote (animation URL) over the connected WebSocket. No-op if not connected. */
  sendEmote(emoteFileUrl: string): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    const msg: AgentWsEmoteMessage = { type: "emote", emoteFileUrl };
    this.ws.send(JSON.stringify(msg));
  }

  /** Close the WebSocket if open and stop reconnecting. */
  disconnect(): void {
    this.disconnectRequested = true;
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  // --- Document CRUD (agent MML API; requires JWT session) ---

  private async ensureSession(): Promise<string> {
    if (this.sessionToken) return this.sessionToken;
    return this.getSessionToken();
  }

  /**
   * Create an agent-owned document. Returns the document id (server-generated if not provided).
   */
  async createDocument(content: string, documentId?: string): Promise<{ documentId: string }> {
    const token = await this.ensureSession();
    const body: { action: "create"; content: string; documentId?: string } = { action: "create", content };
    if (documentId != null && documentId !== "") body.documentId = documentId;
    const data = await fetchJson<{ success: boolean; documentId: string }>(
      `${this.base}/api/agent/mml`,
      {
        method: "POST",
        headers: bearerHeaders(token, this.apiKey),
        body: JSON.stringify(body),
      },
      "POST /api/agent/mml create"
    );
    return { documentId: data.documentId };
  }

  /**
   * Update an agent-owned document. You must be the owner.
   */
  async updateDocument(documentId: string, content: string): Promise<void> {
    const token = await this.ensureSession();
    await fetchJson<{ success: boolean }>(
      `${this.base}/api/agent/mml`,
      {
        method: "POST",
        headers: bearerHeaders(token, this.apiKey),
        body: JSON.stringify({ action: "update", documentId, content }),
      },
      "POST /api/agent/mml update"
    );
  }

  /**
   * Append MML content to an agent-owned document. You must be the owner. Server concatenates existing stored MML with a newline and your content, then applies the result (same entity limits as update).
   */
  async appendDocument(documentId: string, content: string): Promise<void> {
    const token = await this.ensureSession();
    await fetchJson<{ success: boolean }>(
      `${this.base}/api/agent/mml`,
      {
        method: "POST",
        headers: bearerHeaders(token, this.apiKey),
        body: JSON.stringify({ action: "append", documentId, content }),
      },
      "POST /api/agent/mml append"
    );
  }

  /**
   * Delete an agent-owned document. You must be the owner.
   */
  async deleteDocument(documentId: string): Promise<void> {
    const token = await this.ensureSession();
    await fetchJson<{ success: boolean }>(
      `${this.base}/api/agent/mml`,
      {
        method: "POST",
        headers: bearerHeaders(token, this.apiKey),
        body: JSON.stringify({ action: "delete", documentId }),
      },
      "POST /api/agent/mml delete"
    );
  }

  /**
   * List document ids owned by this agent (GET /api/agent/mml).
   */
  async listDocuments(): Promise<string[]> {
    const token = await this.ensureSession();
    const data = await fetchJson<{ content: string; documentIds?: string[] }>(
      `${this.base}/api/agent/mml`,
      { headers: bearerHeaders(token, this.apiKey) },
      "GET /api/agent/mml"
    );
    return data.documentIds ?? [];
  }

  /**
   * List connected occupants (GET /api/agent/occupants). Requires agent session. Each occupant has type: "observer" | "user" | "agent".
   */
  async getOccupants(): Promise<Occupant[]> {
    const token = await this.ensureSession();
    const data = await fetchJson<{ occupants: Occupant[] }>(
      `${this.base}/api/agent/occupants`,
      { headers: bearerHeaders(token, this.apiKey) },
      "GET /api/agent/occupants"
    );
    return data.occupants ?? [];
  }

  /**
   * Fetch chat history (GET /api/chat). Uses session token.
   */
  async getChatHistory(options: GetChatHistoryOptions = {}): Promise<GetChatHistoryResult> {
    const token = await this.ensureSession();
    const limit = Math.min(
      CHAT_LIMIT_MAX,
      Math.max(CHAT_LIMIT_MIN, options.limit ?? CHAT_LIMIT_DEFAULT)
    );
    const params = new URLSearchParams({ limit: String(limit) });
    if (options.before != null && Number.isFinite(options.before)) {
      params.set("before", String(options.before));
    }
    const data = await fetchJson<{ messages: ChatHistoryMessage[]; hasMore?: boolean }>(
      `${this.base}/api/chat?${params}`,
      { headers: bearerHeaders(token, this.apiKey) },
      "GET /api/chat"
    );
    return { messages: data.messages, hasMore: data.hasMore ?? false };
  }
}
