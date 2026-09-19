// warframe.market direct messages. The v1 "im" API is undocumented, so every
// payload is normalized field by field and anything malformed is dropped.

export interface WfmChatUser {
  id: string;
  name: string;
  status: string | null;
  avatar: string | null;
}

export interface WfmChatMessage {
  id: string;
  chatId: string;
  /** Plain text as typed; WFM's rendered HTML variant is never used. */
  text: string;
  /** ISO timestamp. */
  sentAt: string;
  fromUserId: string;
}

export interface WfmChat {
  id: string;
  name: string;
  users: WfmChatUser[];
  unreadCount: number;
  /** ISO timestamp of the last activity. */
  lastUpdate: string;
  lastMessage: WfmChatMessage | null;
}

export type WfmChatConnection = "offline" | "connecting" | "online";

export interface WfmChatState {
  chats: WfmChat[];
  unreadTotal: number;
  connection: WfmChatConnection;
  /** The signed-in account's user id, once known; tells own messages apart. */
  selfId: string | null;
}

export type WfmChatEvent =
  | { type: "state"; state: WfmChatState }
  | { type: "message"; message: WfmChatMessage };

export type WfmChatResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export const WFM_CHAT_MAX_MESSAGE_LENGTH = 2000;
const CHAT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isWfmChatId(value: unknown): value is string {
  return typeof value === "string" && CHAT_ID_PATTERN.test(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeWfmChatUser(raw: unknown): WfmChatUser | null {
  const r = record(raw);
  if (!r) return null;
  const id = text(r.id);
  const name = text(r.ingame_name) || text(r.ingameName) || text(r.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    status: text(r.status) || null,
    avatar: text(r.avatar) || null,
  };
}

/** `chatId` backfills pushes and history rows that omit their chat. */
export function normalizeWfmChatMessage(raw: unknown, chatId = ""): WfmChatMessage | null {
  const r = record(raw);
  if (!r) return null;
  const id = text(r.id);
  const resolvedChat = text(r.chat_id) || chatId;
  if (!id || !resolvedChat) return null;
  return {
    id,
    chatId: resolvedChat,
    text: text(r.raw_message) || stripHtml(text(r.message)),
    sentAt: text(r.send_date),
    fromUserId: text(r.message_from),
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

export function normalizeWfmChat(raw: unknown): WfmChat | null {
  const r = record(raw);
  if (!r) return null;
  const id = text(r.id);
  if (!id) return null;
  const users = (Array.isArray(r.chat_with) ? r.chat_with : [])
    .map(normalizeWfmChatUser)
    .filter((user): user is WfmChatUser => user !== null);
  const messages = (Array.isArray(r.messages) ? r.messages : [])
    .map((message) => normalizeWfmChatMessage(message, id))
    .filter((message): message is WfmChatMessage => message !== null);
  const unread = typeof r.unread_count === "number" && r.unread_count > 0 ? r.unread_count : 0;
  return {
    id,
    name: text(r.chat_name) || users.map((user) => user.name).join(", ") || id,
    users,
    unreadCount: Math.floor(unread),
    lastUpdate: text(r.last_update),
    lastMessage: messages[messages.length - 1] ?? null,
  };
}

export function normalizeWfmChatList(raw: unknown): WfmChat[] {
  return sortWfmChats(
    (Array.isArray(raw) ? raw : [])
      .map(normalizeWfmChat)
      .filter((chat): chat is WfmChat => chat !== null),
  );
}

function sortWfmChats(chats: readonly WfmChat[]): WfmChat[] {
  return [...chats].sort((a, b) => b.lastUpdate.localeCompare(a.lastUpdate));
}

export function totalUnread(chats: readonly WfmChat[]): number {
  return chats.reduce((sum, chat) => sum + chat.unreadCount, 0);
}

/** Fold a pushed message into the chat list. Null means the chat is unknown and
 *  the list has to be fetched again. A message counts as unread unless it is our
 *  own or its chat is the one open on screen. */
export function applyWfmChatMessage(
  chats: readonly WfmChat[],
  message: WfmChatMessage,
  opts: { activeChatId: string | null; selfId: string | null },
): WfmChat[] | null {
  const index = chats.findIndex((chat) => chat.id === message.chatId);
  if (index < 0) return null;
  const chat = chats[index] as WfmChat;
  if (chat.lastMessage?.id === message.id) return [...chats];
  const counts = message.fromUserId !== opts.selfId && opts.activeChatId !== chat.id;
  const next = [...chats];
  next[index] = {
    ...chat,
    lastMessage: message,
    lastUpdate: message.sentAt || chat.lastUpdate,
    unreadCount: chat.unreadCount + (counts ? 1 : 0),
  };
  return sortWfmChats(next);
}
