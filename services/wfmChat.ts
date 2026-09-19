import WebSocket from "ws";

import { normalizeErrorMessage } from "../config/shared/errors";
import {
  WFM_CHAT_MAX_MESSAGE_LENGTH,
  applyWfmChatMessage,
  normalizeWfmChatList,
  normalizeWfmChatMessage,
  totalUnread,
  type WfmChat,
  type WfmChatConnection,
  type WfmChatEvent,
  type WfmChatMessage,
  type WfmChatState,
} from "../config/shared/wfmChat";
import { withScope } from "./logger";
import { request } from "./wfmClient";
import { getMe, getToken } from "./wfmSession";
import { parseWfmWsMessage } from "./wfmWebSocketCommon";

const log = withScope("wfmChat");

// Chat still lives on warframe.market's first-generation socket: cookie auth
// and `type` envelopes, unlike the v2 socket the status listener uses.
const CHAT_WS_URL = "wss://warframe.market/socket?platform=pc";
const CHAT_WS_ORIGIN = "https://warframe.market";
const CHAT_WS_MAX_PAYLOAD_BYTES = 1024 * 1024;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_CAP_MS = 60_000;
const PING_INTERVAL_MS = 30_000;
const SEND_CONFIRM_TIMEOUT_MS = 10_000;

type Listener = (event: WfmChatEvent) => void;
type NewMessageHook = (chat: WfmChat, message: WfmChatMessage, from: string) => void;

let _active = false;
let _socket: WebSocket | null = null;
let _connection: WfmChatConnection = "offline";
let _reconnectAttempt = 0;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _pingTimer: ReturnType<typeof setInterval> | null = null;
let _chats: WfmChat[] = [];
let _selfId: string | null = null;
let _activeChatId: string | null = null;
let _isActiveChatVisible: () => boolean = () => true;
let _listener: Listener | null = null;
let _onNewMessage: NewMessageHook | null = null;
let _refreshInFlight: Promise<void> | null = null;

interface PendingSend {
  chatId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
let _pendingSends: PendingSend[] = [];

export function getState(): WfmChatState {
  return {
    chats: _chats,
    unreadTotal: totalUnread(_chats),
    connection: _connection,
    selfId: _selfId,
  };
}

function emitState(): void {
  _listener?.({ type: "state", state: getState() });
}

function setConnection(next: WfmChatConnection): void {
  if (_connection === next) return;
  _connection = next;
  emitState();
}

function shownChatId(): string | null {
  return _activeChatId && _isActiveChatVisible() ? _activeChatId : null;
}

function failPendingSends(reason: string): void {
  const pending = _pendingSends;
  _pendingSends = [];
  for (const entry of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
  }
}

function clearTimers(): void {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  if (_pingTimer) clearInterval(_pingTimer);
  _reconnectTimer = null;
  _pingTimer = null;
}

function destroySocket(): void {
  const socket = _socket;
  _socket = null;
  if (!socket) return;
  socket.removeAllListeners();
  // A terminate on a still-connecting socket emits an error with no listener left.
  socket.on("error", () => {});
  try {
    socket.terminate();
  } catch {
    /* ignore */
  }
}

function scheduleReconnect(): void {
  if (!_active) return;
  clearTimers();
  destroySocket();
  failPendingSends("Connection to warframe.market lost.");
  setConnection("connecting");
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** _reconnectAttempt, RECONNECT_CAP_MS);
  _reconnectAttempt++;
  log.info(`[Chat] reconnecting in ${delay}ms (attempt ${_reconnectAttempt})`);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    connect();
  }, delay);
  _reconnectTimer.unref?.();
}

function connect(): void {
  if (!_active) return;
  // Read at connect time: WFM rotates the token during long sessions.
  const token = getToken();
  if (!token) {
    stop();
    return;
  }
  destroySocket();
  setConnection("connecting");
  const socket = new WebSocket(CHAT_WS_URL, {
    origin: CHAT_WS_ORIGIN,
    headers: { Cookie: `JWT=${token}` },
    handshakeTimeout: 15_000,
    maxPayload: CHAT_WS_MAX_PAYLOAD_BYTES,
    perMessageDeflate: false,
  });
  _socket = socket;

  socket.on("open", () => {
    if (_socket !== socket) return;
    _reconnectAttempt = 0;
    log.info("[Chat] socket connected");
    setConnection("online");
    _pingTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }, PING_INTERVAL_MS);
    _pingTimer.unref?.();
    // Anything that arrived while the socket was down only shows up in the list.
    void refresh().catch(() => {});
  });

  socket.on("message", (data) => {
    if (_socket !== socket) return;
    const msg = parseWfmWsMessage(data);
    const type = typeof msg?.type === "string" ? msg.type : "";
    if (!msg || !type) return;
    if (type.endsWith("chats/NEW_MESSAGE")) handleIncoming(msg.payload, false);
    else if (type.endsWith("chats/MESSAGE_SENT")) handleIncoming(msg.payload, true);
  });

  socket.on("error", (err) => {
    if (_socket !== socket) return;
    log.warn("[Chat] socket error:", normalizeErrorMessage(err));
    scheduleReconnect();
  });

  socket.on("close", () => {
    if (_socket !== socket) return;
    log.info("[Chat] socket closed");
    scheduleReconnect();
  });
}

function handleIncoming(payload: unknown, sentByUs: boolean): void {
  // MESSAGE_SENT wraps the message next to a temp id; NEW_MESSAGE is the message.
  const raw = sentByUs ? (payload as { message?: unknown } | null)?.message : payload;
  const message = normalizeWfmChatMessage(raw);
  if (!message) {
    log.warn("[Chat] unparseable chat push dropped");
    return;
  }

  if (sentByUs) {
    if (!_selfId && message.fromUserId) _selfId = message.fromUserId;
    const index = _pendingSends.findIndex((entry) => entry.chatId === message.chatId);
    if (index >= 0) {
      const [entry] = _pendingSends.splice(index, 1);
      if (entry) {
        clearTimeout(entry.timer);
        entry.resolve();
      }
    }
  }

  _listener?.({ type: "message", message });

  const next = applyWfmChatMessage(_chats, message, {
    activeChatId: shownChatId(),
    selfId: sentByUs ? message.fromUserId : _selfId,
  });
  if (next) {
    _chats = next;
    emitState();
    notify(message, sentByUs);
    return;
  }
  // First message of a chat we have never listed.
  void refresh()
    .then(() => notify(message, sentByUs))
    .catch(() => {});
}

function notify(message: WfmChatMessage, sentByUs: boolean): void {
  if (sentByUs || message.fromUserId === _selfId) return;
  if (shownChatId() === message.chatId) return;
  const chat = _chats.find((entry) => entry.id === message.chatId);
  if (!chat) return;
  const from = chat.users.find((user) => user.id === message.fromUserId)?.name ?? chat.name;
  try {
    _onNewMessage?.(chat, message, from);
  } catch (err) {
    log.warn("[Chat] new-message hook threw:", normalizeErrorMessage(err));
  }
}

export function refresh(): Promise<void> {
  if (_refreshInFlight) return _refreshInFlight;
  const run = (async () => {
    const body = (await request("GET", "/im/chats")) as { payload?: { chats?: unknown } } | null;
    _chats = normalizeWfmChatList(body?.payload?.chats);
    log.info(`[Chat] refreshed ${_chats.length} chats`);
    emitState();
  })().finally(() => {
    if (_refreshInFlight === run) _refreshInFlight = null;
  });
  _refreshInFlight = run;
  return run;
}

/** Fetching a chat is also what marks it read on warframe.market. */
export async function getMessages(chatId: string): Promise<WfmChatMessage[]> {
  const body = (await request("GET", `/im/chats/${encodeURIComponent(chatId)}`)) as {
    payload?: { messages?: unknown };
  } | null;
  const rows = Array.isArray(body?.payload?.messages) ? body.payload.messages : [];
  const messages = rows
    .map((row) => normalizeWfmChatMessage(row, chatId))
    .filter((message): message is WfmChatMessage => message !== null)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const chat = _chats.find((entry) => entry.id === chatId);
  if (chat && chat.unreadCount > 0) {
    _chats = _chats.map((entry) => (entry.id === chatId ? { ...entry, unreadCount: 0 } : entry));
    emitState();
  }
  return messages;
}

export function sendMessage(chatId: string, text: string): Promise<void> {
  const message = text.trim();
  if (!message) return Promise.reject(new Error("Message is empty."));
  if (message.length > WFM_CHAT_MAX_MESSAGE_LENGTH)
    return Promise.reject(new Error("Message is too long."));
  const socket = _socket;
  if (!socket || socket.readyState !== WebSocket.OPEN)
    return Promise.reject(new Error("Not connected to warframe.market chat."));

  return new Promise<void>((resolve, reject) => {
    const entry: PendingSend = {
      chatId,
      resolve,
      reject,
      timer: setTimeout(() => {
        _pendingSends = _pendingSends.filter((pending) => pending !== entry);
        reject(new Error("warframe.market did not confirm the message."));
      }, SEND_CONFIRM_TIMEOUT_MS),
    };
    _pendingSends.push(entry);
    socket.send(
      JSON.stringify({ type: "@WS/chats/SEND_MESSAGE", payload: { chat_id: chatId, message } }),
      (err) => {
        if (!err) return;
        _pendingSends = _pendingSends.filter((pending) => pending !== entry);
        clearTimeout(entry.timer);
        reject(err);
      },
    );
  });
}

/** Leaves the chat on warframe.market; the local row only goes once that worked. */
export async function deleteChat(chatId: string): Promise<void> {
  await request("DELETE", `/im/chats/${encodeURIComponent(chatId)}`);
  log.info("[Chat] deleted chat", chatId);
  if (_activeChatId === chatId) _activeChatId = null;
  _chats = _chats.filter((chat) => chat.id !== chatId);
  emitState();
}

export function setActiveChat(chatId: string | null): void {
  _activeChatId = chatId;
}

export function start(options: {
  onEvent: Listener;
  onNewMessage: NewMessageHook;
  isActiveChatVisible: () => boolean;
}): void {
  stop();
  if (!getToken()) return;
  _active = true;
  _listener = options.onEvent;
  _onNewMessage = options.onNewMessage;
  _isActiveChatVisible = options.isActiveChatVisible;
  log.info("[Chat] starting");
  void getMe().then((me) => {
    if (!_active || !me?.id) return;
    _selfId = me.id;
    emitState();
  });
  connect();
}

export function stop(): void {
  const wasActive = _active;
  _active = false;
  clearTimers();
  destroySocket();
  failPendingSends("Signed out.");
  _chats = [];
  _selfId = null;
  _activeChatId = null;
  _reconnectAttempt = 0;
  _connection = "offline";
  if (wasActive) {
    log.info("[Chat] stopped");
    emitState();
  }
  _listener = null;
  _onNewMessage = null;
}
