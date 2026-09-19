import { derived, writable, type Readable } from "svelte/store";

import { invoke, on } from "../lib/ipc.js";
import type { WfmChatMessage, WfmChatState } from "../../config/shared/wfmChat.js";

// Main owns the chat list and the socket; this store mirrors its pushes.
const EMPTY: WfmChatState = { chats: [], unreadTotal: 0, connection: "offline", selfId: null };
const store = writable<WfmChatState>(EMPTY);

export const wfmChatState: Readable<WfmChatState> = { subscribe: store.subscribe };
export const wfmChatUnread: Readable<number> = derived(store, (state) => state.unreadTotal);

type MessageListener = (message: WfmChatMessage) => void;
const messageListeners = new Set<MessageListener>();

/** New messages as they arrive, own ones included; returns the unsubscribe. */
export function onWfmChatMessage(listener: MessageListener): () => void {
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
}

export function setWfmChatState(state: WfmChatState): void {
  store.set(state);
}

/** Wired once from rendererEvents, so the sidebar badge counts from app start. */
export function initWfmChatStore(): () => void {
  void invoke("wfmChatState")
    .then((state) => store.set(state))
    .catch(() => {});
  return on("wfm-chat:event", (event) => {
    if (event.type === "state") store.set(event.state);
    else for (const listener of messageListeners) listener(event.message);
  });
}
