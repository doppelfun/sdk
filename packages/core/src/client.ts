/**
 * Unified Doppel agent client: single entry point for session, document CRUD,
 * Agent WebSocket (connect, move, chat, join), and chat history.
 */

import { fetchJson, normalizeBaseUrl } from "./utils.js";
import { getAgentWsUrl, getAgentWsUrlWithoutToken, AGENT_WS_DEFAULT_PATH } from "./agentWs.js";
import type {
  AgentWsInputMessage,
  AgentWsChatMessage,
  AgentWsThinkingMessage,
  AgentWsJoinMessage,
  AgentWsEmoteMessage,
  AgentWsSpeakMessage,
  AgentWsMoveToMessage,
} from "./agentWs.js";
import type { ChatHistoryMessage, GetChatHistoryOptions, GetChatHistoryResult } from "./chat.js";

const CHAT_LIMIT_MIN = 1;
const CHAT_LIMIT_MAX = 500;
const CHAT_LIMIT_DEFAULT = 100;

/** Occupant type from GET /api/occupants. */
export type OccupantType = "observer" | "user" | "agent" | "npc";

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
  /** Engine HTTP(S) base; updated by {@link fullReconnect} when the hub returns a new serverUrl. */
  private base: string;
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
  /** When true, socket close does not schedule backoff reconnect (used by reconnectNow). */
  private skipReconnectOnClose = false;

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
   * Get or refresh session token (POST /api/session with JWT). Cached until next call.
   */
  async getSessionToken(): Promise<string> {
    const jwt = await Promise.resolve(this.getJwt());
    const headers = authHeaders(this.getJwt, this.apiKey);
    const data = await fetchJson<{ sessionToken: string }>(
      `${this.base}/api/session`,
      { method: "POST", headers, body: JSON.stringify({ token: jwt }) },
      "session"
    );
    this.sessionToken = data.sessionToken;
    return data.sessionToken;
  }

  /**
   * Build the Agent WebSocket URL with the hub-issued JWT (from getJwt).
   * The engine validates this JWT for the WebSocket; use the same JWT returned by joinBlock/hub.
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
   * Connects without token in URL and sends { type: "auth", token } after auth_required
   * so the engine creates only one session (one avatar).
   */
  private async doConnect(): Promise<void> {
    const Ws = this.WsConstructor;
    if (!Ws) {
      throw new Error("DoppelClient: pass options.WebSocket (e.g. from 'ws' in Node) or use in a browser with global WebSocket");
    }
    const url = getAgentWsUrlWithoutToken(this.base, this.agentWsPath);
    return new Promise((resolve, reject) => {
      const socket = new Ws(url) as WebSocket & { on?: (ev: string, fn: (e: unknown) => void) => void; off?: (ev: string, fn: (e: unknown) => void) => void; send?: (data: string) => void };
      this.ws = socket;
      let authenticatedDone = false;

      const sendAuth = (): void => {
        Promise.resolve(this.getJwt()).then((jwt) => {
          if (socket.readyState === socket.OPEN && typeof socket.send === "function") {
            socket.send(JSON.stringify({ type: "auth", token: jwt }));
          }
        }).catch(() => {});
      };

      const onMessage = (raw: unknown) => {
        const text =
          typeof raw === "string"
            ? raw
            : new TextDecoder().decode(
                raw instanceof Uint8Array ? raw : new Uint8Array((raw as ArrayBuffer) || [])
              );
        let msg: { type?: string; code?: string; error?: string; [k: string]: unknown };
        try {
          msg = JSON.parse(text) as { type?: string; code?: string; error?: string; [k: string]: unknown };
        } catch {
          return;
        }
        const type = typeof msg.type === "string" ? msg.type : "";
        if (type === "authenticated") {
          if (authenticatedDone) return;
          authenticatedDone = true;
          removeErrorListener();
          this.reconnectAttempt = 0;
          // WS (re)auth mints a fresh engine session; drop cached Bearer so HTTP calls re-POST /api/session.
          this.sessionToken = null;
          resolve();
          this.emitMessage("authenticated", msg);
          return;
        }
        if (type === "error") {
          const code = typeof msg.code === "string" ? msg.code : "";
          const errText = String(msg.error ?? "");
          const isAuthRequired = code === "auth_required" || /auth_required/i.test(errText);
          if (isAuthRequired) {
            sendAuth();
            return;
          }
          removeErrorListener();
          reject(new Error(`Agent WS error: ${code} ${errText}`));
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
        // Ignore stale close if we already replaced the socket (e.g. reconnectNow).
        if (this.ws !== socket) return;
        this.ws = null;
        removeErrorListener();
        if (this.skipReconnectOnClose) {
          this.skipReconnectOnClose = false;
          return;
        }
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

  /** Send movement (input) over the connected WebSocket. No-op if not connected. rotY: optional facing (radians) when stationary. */
  sendInput(params: { moveX?: number; moveZ?: number; sprint?: boolean; jump?: boolean; rotY?: number }): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    const msg: AgentWsInputMessage = {
      type: "input",
      moveX: params.moveX ?? 0,
      moveZ: params.moveZ ?? 0,
      sprint: params.sprint ?? false,
      jump: params.jump ?? false,
      ...(typeof params.rotY === "number" && { rotY: params.rotY }),
    };
    this.ws.send(JSON.stringify(msg));
  }

  /** Send a chat message over the connected WebSocket. No-op if not connected. Use targetSessionId for DM; voiceId for TTS voice (e.g. from CLAW_VOICE_ID). */
  sendChat(
    text: string,
    options?: { targetSessionId?: string; voiceId?: string; ephemeral?: boolean }
  ): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    const msg: AgentWsChatMessage = {
      type: "chat",
      text,
      ...(options?.targetSessionId && { targetSessionId: options.targetSessionId }),
      ...(options?.voiceId?.trim() && { voiceId: options.voiceId.trim() }),
      ...(options?.ephemeral === true && { ephemeral: true }),
    };
    this.ws.send(JSON.stringify(msg));
  }

  /** Request to join another region over the connected WebSocket. No-op if not connected. */
  sendJoin(regionId: string): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    const msg: AgentWsJoinMessage = { type: "join", regionId };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Broadcast thinking state for this session (e.g. while LLM runs).
   * Server fans out to the room so UIs can show an indicator on the avatar.
   */
  sendThinking(thinking: boolean): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    const msg: AgentWsThinkingMessage = { type: "thinking", thinking };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Play an emote by catalog id (e.g. wave, heart, thumbs, clap, dance, shocked).
   * No-op if not connected. Server accepts only known ids (see @doppel-engine/schema EMOTES).
   */
  sendEmote(emoteId: string): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    const msg: AgentWsEmoteMessage = { type: "emote", emoteId: emoteId.trim() };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Request voice (TTS) for this text. Engine runs TTS and publishes to LiveKit when someone is nearby.
   * No-op if not connected.
   */
  sendSpeak(text: string, options?: { voiceId?: string }): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    const msg: AgentWsSpeakMessage = {
      type: "speak",
      text: text.trim().slice(0, 500),
      ...(options?.voiceId?.trim() && { voiceId: options.voiceId.trim() }),
    };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Server-driven move to (x, z). Block-local 0–100. Server pathfinds and moves the agent each tick; no waypoints sent.
   */
  moveTo(x: number, z: number): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    const msg: AgentWsMoveToMessage = { type: "move_to", x, z };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Cancel current server-driven move_to (e.g. when owner tells agent to stop). Use with sendInput(0,0) from the stop tool.
   */
  cancelMove(): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "cancel_move" }));
  }

  /**
   * Follow another occupant by sessionId. Server re-paths to the target's current position periodically (real-time).
   * For stopping at a distance (e.g. conversation range), use approach() instead.
   */
  follow(targetSessionId: string): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "follow", targetSessionId: String(targetSessionId).trim() }));
  }

  /**
   * Cancel current follow (stop following).
   */
  cancelFollow(): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "cancel_follow" }));
  }

  /**
   * Approach another occupant by sessionId; server re-paths to target's current position and stops when within stopDistanceM, then sends approach_arrived.
   */
  approach(targetSessionId: string, options: { stopDistanceM: number }): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    const stopDistanceM = typeof options?.stopDistanceM === "number" && options.stopDistanceM > 0 ? options.stopDistanceM : 1;
    this.ws.send(JSON.stringify({ type: "approach", targetSessionId: String(targetSessionId).trim(), stopDistanceM }));
  }

  /**
   * Cancel current approach.
   */
  cancelApproach(): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify({ type: "cancel_approach" }));
  }

  /**
   * Close the current WebSocket and immediately open a new one using the latest
   * JWT from getJwt() (e.g. after hub joinBlock refresh). Waits for `authenticated`
   * again. Does not set disconnectRequested — reconnect policy remains active.
   */
  async reconnectNow(): Promise<void> {
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    const socket = this.ws;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) {
      this.skipReconnectOnClose = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      // onClose may run sync; ensure ws cleared before doConnect
      if (this.ws === socket) this.ws = null;
    }
    // If close didn't run onClose (already closed), don't leave flag set
    if (this.skipReconnectOnClose && !socket) this.skipReconnectOnClose = false;
    await this.doConnect();
  }

  /**
   * GET /health on the engine (liveness: 200 and plain body `ok`). False on timeout, non-OK, or network error.
   */
  async checkEngineHealth(timeoutMs: number = 5000): Promise<boolean> {
    const url = `${this.base}/health`;
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: "GET", signal: ac.signal });
      if (!res.ok) return false;
      const text = (await res.text()).trim();
      return text === "ok";
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  /** Update engine base URL (e.g. hub joinBlock returned a new serverUrl). Next HTTP/WS use this host. */
  setEngineUrl(url: string): void {
    const trimmed = url.trim();
    if (trimmed) this.base = normalizeBaseUrl(trimmed);
  }

  /**
   * Cold start after engine deploy/restart: close any socket without scheduling backoff, optionally run
   * hub refresh / URL update, clear cached engine session, reset reconnect backoff, then connect again.
   */
  async fullReconnect(options?: {
    beforeConnect?: () => Promise<void>;
    /** When non-empty, sets the engine base URL before connecting. */
    engineUrl?: string;
  }): Promise<void> {
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    const socket = this.ws;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) {
      this.skipReconnectOnClose = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      if (this.ws === socket) this.ws = null;
    }
    if (this.skipReconnectOnClose && !socket) this.skipReconnectOnClose = false;

    await options?.beforeConnect?.();
    const nextUrl = options?.engineUrl?.trim();
    if (nextUrl) this.base = normalizeBaseUrl(nextUrl);

    this.disconnectRequested = false;
    this.reconnectAttempt = 0;
    this.sessionToken = null;
    await this.doConnect();
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
   * True when fetchJson failed with HTTP 401 or engine session error body (message shape can vary by route).
   */
  private isLikelyExpiredSessionError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    if (/\b401\b/.test(msg)) return true;
    return /invalid or expired session/i.test(msg);
  }

  /**
   * Run an operation that uses ensureSession + Bearer. On session errors, clear cached token and retry
   * (up to 3 attempts) so POST /api/session can mint a fresh engine session.
   */
  private async withSessionRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await operation();
      } catch (e) {
        lastError = e;
        if (!this.isLikelyExpiredSessionError(e)) throw e;
        if (attempt === 2) throw e;
        this.sessionToken = null;
      }
    }
    throw lastError;
  }

  /** Clear cached engine session token; next HTTP call re-POSTs /api/session with the current hub JWT. */
  clearCachedSessionToken(): void {
    this.sessionToken = null;
  }

  /**
   * Create an agent-owned document. Returns the document id (server-generated if not provided).
   */
  async createDocument(content: string, documentId?: string): Promise<{ documentId: string }> {
    return this.withSessionRetry(async () => {
      const token = await this.ensureSession();
      const body: { action: "create"; content: string; documentId?: string } = { action: "create", content };
      if (documentId != null && documentId !== "") body.documentId = documentId;
      const data = await fetchJson<{ success: boolean; documentId: string }>(
        `${this.base}/api/document`,
        {
          method: "POST",
          headers: bearerHeaders(token, this.apiKey),
          body: JSON.stringify(body),
        },
        "POST /api/document create"
      );
      return { documentId: data.documentId };
    });
  }

  /**
   * Update an agent-owned document. You must be the owner.
   */
  async updateDocument(documentId: string, content: string): Promise<void> {
    return this.withSessionRetry(async () => {
      const token = await this.ensureSession();
      await fetchJson<{ success: boolean }>(
        `${this.base}/api/document`,
        {
          method: "POST",
          headers: bearerHeaders(token, this.apiKey),
          body: JSON.stringify({ action: "update", documentId, content }),
        },
        "POST /api/document update"
      );
    });
  }

  /**
   * Append MML content to an agent-owned document. You must be the owner. Server concatenates existing stored MML with a newline and your content, then applies the result (same limits as update (triangle count, content size)).
   */
  async appendDocument(documentId: string, content: string): Promise<void> {
    return this.withSessionRetry(async () => {
      const token = await this.ensureSession();
      await fetchJson<{ success: boolean }>(
        `${this.base}/api/document`,
        {
          method: "POST",
          headers: bearerHeaders(token, this.apiKey),
          body: JSON.stringify({ action: "append", documentId, content }),
        },
        "POST /api/document append"
      );
    });
  }

  /**
   * Delete an agent-owned document. You must be the owner.
   */
  async deleteDocument(documentId: string): Promise<void> {
    return this.withSessionRetry(async () => {
      const token = await this.ensureSession();
      await fetchJson<{ success: boolean }>(
        `${this.base}/api/document`,
        {
          method: "POST",
          headers: bearerHeaders(token, this.apiKey),
          body: JSON.stringify({ action: "delete", documentId }),
        },
        "POST /api/document delete"
      );
    });
  }

  /**
   * List document ids owned by this agent (GET /api/document).
   */
  async listDocuments(): Promise<string[]> {
    return this.withSessionRetry(async () => {
      const token = await this.ensureSession();
      const data = await fetchJson<{ content: string; documentIds?: string[] }>(
        `${this.base}/api/document`,
        { headers: bearerHeaders(token, this.apiKey) },
        "GET /api/document"
      );
      return data.documentIds ?? [];
    });
  }

  /**
   * Fetch stored MML for a document (GET /api/document/content?documentId=).
   * Owner agent only. Returns truncated content if over server limit.
   */
  async getDocumentContent(documentId: string): Promise<{
    documentId: string;
    content: string;
    truncated: boolean;
    totalChars?: number;
  }> {
    return this.withSessionRetry(async () => {
      const token = await this.ensureSession();
      const params = new URLSearchParams({ documentId });
      return fetchJson<{
        documentId: string;
        content: string;
        truncated: boolean;
        totalChars?: number;
      }>(
        `${this.base}/api/document/content?${params}`,
        { headers: bearerHeaders(token, this.apiKey) },
        "GET /api/document/content"
      );
    });
  }

  /**
   * List connected occupants (GET /api/occupants). Any session. Each occupant has type: "observer" | "user" | "agent" | "npc".
   */
  async getOccupants(): Promise<Occupant[]> {
    return this.withSessionRetry(async () => {
      const token = await this.ensureSession();
      const data = await fetchJson<{ occupants: Occupant[] }>(
        `${this.base}/api/occupants`,
        { headers: bearerHeaders(token, this.apiKey) },
        "GET /api/occupants"
      );
      return data.occupants ?? [];
    });
  }

  /**
   * Fetch chat history (GET /api/chat). Uses session token.
   */
  async getChatHistory(options: GetChatHistoryOptions = {}): Promise<GetChatHistoryResult> {
    return this.withSessionRetry(async () => {
      const token = await this.ensureSession();
      const limit = Math.min(
        CHAT_LIMIT_MAX,
        Math.max(CHAT_LIMIT_MIN, options.limit ?? CHAT_LIMIT_DEFAULT)
      );
      const params = new URLSearchParams({ limit: String(limit) });
      if (options.before != null && Number.isFinite(options.before)) {
        params.set("before", String(options.before));
      }
      if (options.regionId != null && options.regionId !== "") {
        params.set("blockSlotId", options.regionId);
      }
      if (options.channelId != null && options.channelId !== "") {
        params.set("channelId", options.channelId);
      }
      const data = await fetchJson<{ messages: ChatHistoryMessage[]; hasMore?: boolean }>(
        `${this.base}/api/chat?${params}`,
        { headers: bearerHeaders(token, this.apiKey) },
        "GET /api/chat"
      );
      return { messages: data.messages, hasMore: data.hasMore ?? false };
    });
  }
}
