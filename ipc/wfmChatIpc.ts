import fs from "node:fs";

import { app } from "electron";

import {
  WFM_CHAT_DELETE,
  WFM_CHAT_EVENT,
  WFM_CHAT_MESSAGES,
  WFM_CHAT_REFRESH,
  WFM_CHAT_SEND,
  WFM_CHAT_SET_ACTIVE,
  WFM_CHAT_STATE,
} from "../config/shared/ipcChannels";
import { normalizeErrorMessage } from "../config/shared/errors";
import {
  WFM_CHAT_MAX_MESSAGE_LENGTH,
  applyWfmChatMessage,
  isWfmChatId,
  normalizeWfmChatList,
  normalizeWfmChatMessage,
  totalUnread,
  type WfmChat,
  type WfmChatEvent,
  type WfmChatMessage,
  type WfmChatState,
} from "../config/shared/wfmChat";
import { withScope } from "../services/logger";
import * as wfmChat from "../services/wfmChat";
import ctx from "./context";
import { assertMainRendererSender, handleAuthorized } from "./ipcSecurity";
import { isObject } from "./ipcValidators";
import { playNotificationSound, sendDesktopNotificationRaw } from "./worldStateIpc";

const log = withScope("wfmChatIpc");

function pushEvent(event: WfmChatEvent): void {
  const win = ctx.mainWindow;
  if (!win || win.isDestroyed()) return;
  win.webContents.send(WFM_CHAT_EVENT, event);
}

function isActiveChatVisible(): boolean {
  const win = ctx.mainWindow;
  return !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused();
}

function onNewMessage(chat: WfmChat, message: WfmChatMessage, from: string): void {
  log.info("[Chat] new message in chat", chat.id);
  // Rings the notification sound chosen in Settings. A toast rings it itself, so
  // it is only played here when "WFM DM notifications" keeps the toast off.
  if (!ctx.overlaySettings?.wfmNotificationsEnabled) {
    playNotificationSound();
    return;
  }
  sendDesktopNotificationRaw(`warframe.market: ${from}`, message.text.slice(0, 200), "message");
}

interface ChatBackend {
  getState(): WfmChatState;
  refresh(): Promise<void>;
  getMessages(chatId: string): Promise<WfmChatMessage[]>;
  sendMessage(chatId: string, text: string): Promise<void>;
  deleteChat(chatId: string): Promise<void>;
  setActiveChat(chatId: string | null): void;
}

/** E2E-only in-memory chat backend, disabled in packaged builds. A sent message
 *  that starts with "/echo" is answered, standing in for an incoming push. */
function fixtureBackend(file: string): ChatBackend {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
    selfId?: string;
    chats?: unknown;
    messages?: Record<string, unknown[]>;
  };
  const selfId = raw.selfId ?? "self";
  let chats = normalizeWfmChatList(raw.chats);
  let activeChatId: string | null = null;
  let counter = 0;
  const history = new Map<string, WfmChatMessage[]>();
  for (const [chatId, rows] of Object.entries(raw.messages ?? {})) {
    history.set(
      chatId,
      rows
        .map((row) => normalizeWfmChatMessage(row, chatId))
        .filter((message): message is WfmChatMessage => message !== null),
    );
  }
  const state = (): WfmChatState => ({
    chats,
    unreadTotal: totalUnread(chats),
    connection: "online",
    selfId,
  });
  const deliver = (chatId: string, fromUserId: string, text: string): void => {
    const message: WfmChatMessage = {
      id: `fixture-${++counter}`,
      chatId,
      text,
      sentAt: new Date().toISOString(),
      fromUserId,
    };
    history.set(chatId, [...(history.get(chatId) ?? []), message]);
    pushEvent({ type: "message", message });
    const shown = activeChatId && isActiveChatVisible() ? activeChatId : null;
    chats = applyWfmChatMessage(chats, message, { activeChatId: shown, selfId }) ?? chats;
    pushEvent({ type: "state", state: state() });
    const chat = chats.find((entry) => entry.id === chatId);
    if (chat && fromUserId !== selfId) onNewMessage(chat, message, chat.name);
  };
  return {
    getState: state,
    refresh: async () => pushEvent({ type: "state", state: state() }),
    getMessages: async (chatId) => {
      chats = chats.map((chat) => (chat.id === chatId ? { ...chat, unreadCount: 0 } : chat));
      pushEvent({ type: "state", state: state() });
      return history.get(chatId) ?? [];
    },
    sendMessage: async (chatId, text) => {
      deliver(chatId, selfId, text);
      if (text.startsWith("/echo")) {
        const other = chats.find((chat) => chat.id === chatId)?.users[0]?.id ?? "other";
        // Blurring first makes the reply count as unseen, like a real push would.
        setTimeout(() => {
          activeChatId = null;
          deliver(chatId, other, text.slice(5).trim() || "echo");
        }, 50);
      }
    },
    deleteChat: async (chatId) => {
      chats = chats.filter((chat) => chat.id !== chatId);
      history.delete(chatId);
      pushEvent({ type: "state", state: state() });
    },
    setActiveChat: (chatId) => {
      activeChatId = chatId;
    },
  };
}

let _backend: ChatBackend = wfmChat;
let _fixture = false;

/** Brought up behind a live token (sign-in or session restore). */
export function startChat(): void {
  if (_fixture) return;
  wfmChat.start({ onEvent: pushEvent, onNewMessage, isActiveChatVisible });
}

export function stopChat(): void {
  if (_fixture) return;
  wfmChat.stop();
}

async function guarded<T extends object>(
  label: string,
  fn: () => Promise<T>,
): Promise<({ ok: true } & T) | { ok: false; error: string }> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    const error = normalizeErrorMessage(err, "warframe.market request failed.");
    log.warn(`[Chat] ${label} failed:`, error);
    return { ok: false, error };
  }
}

export function register(): void {
  const fixtureFile = process.env.WFHELPER_WFM_CHAT_FIXTURES;
  if (fixtureFile && !app.isPackaged) {
    log.warn("[Chat] serving chat IPC from fixtures:", fixtureFile);
    _backend = fixtureBackend(fixtureFile);
    _fixture = true;
  }

  handleAuthorized(WFM_CHAT_STATE, assertMainRendererSender, () => _backend.getState());

  handleAuthorized(WFM_CHAT_REFRESH, assertMainRendererSender, () =>
    guarded("refresh", async () => {
      await _backend.refresh();
      return { state: _backend.getState() };
    }),
  );

  handleAuthorized(WFM_CHAT_MESSAGES, assertMainRendererSender, (_event, chatId: unknown) =>
    guarded("messages", async () => {
      if (!isWfmChatId(chatId)) throw new Error("Invalid chat id.");
      return { messages: await _backend.getMessages(chatId) };
    }),
  );

  handleAuthorized(WFM_CHAT_SEND, assertMainRendererSender, (_event, payload: unknown) =>
    guarded("send", async () => {
      const p = isObject(payload) ? payload : {};
      const text = typeof p.text === "string" ? p.text.trim() : "";
      if (!isWfmChatId(p.chatId)) throw new Error("Invalid chat id.");
      if (!text || text.length > WFM_CHAT_MAX_MESSAGE_LENGTH) throw new Error("Invalid message.");
      await _backend.sendMessage(p.chatId, text);
      return {};
    }),
  );

  handleAuthorized(WFM_CHAT_DELETE, assertMainRendererSender, (_event, chatId: unknown) =>
    guarded("delete", async () => {
      if (!isWfmChatId(chatId)) throw new Error("Invalid chat id.");
      await _backend.deleteChat(chatId);
      return {};
    }),
  );

  handleAuthorized(WFM_CHAT_SET_ACTIVE, assertMainRendererSender, (_event, chatId: unknown) => {
    _backend.setActiveChat(isWfmChatId(chatId) ? chatId : null);
  });
}
