<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";

  import { tr } from "../lib/i18n.js";
  import { confirmWithDialog, invoke, send } from "../lib/ipc.js";
  import { currentView } from "../stores/app.js";
  import { onWfmChatMessage, setWfmChatState, wfmChatState } from "../stores/wfmChat.js";
  import {
    WFM_CHAT_MAX_MESSAGE_LENGTH,
    type WfmChat,
    type WfmChatMessage,
    type WfmChatUser,
  } from "../../config/shared/wfmChat.js";

  const CONNECTION_KEYS = {
    offline: "messages.connection.offline",
    connecting: "messages.connection.connecting",
    online: "messages.connection.online",
  } as const;

  let search = $state("");
  let activeId = $state<string | null>(null);
  let messages = $state<WfmChatMessage[]>([]);
  let loadingMessages = $state(false);
  let refreshing = $state(false);
  let sending = $state(false);
  let draft = $state("");
  let error = $state<string | null>(null);
  let scroller = $state<HTMLElement | null>(null);

  const chats = $derived(
    $wfmChatState.chats.filter((chat) =>
      chat.name.toLowerCase().includes(search.trim().toLowerCase()),
    ),
  );
  const activeChat = $derived($wfmChatState.chats.find((chat) => chat.id === activeId) ?? null);
  const selfId = $derived($wfmChatState.selfId);

  function partner(chat: WfmChat): WfmChatUser | null {
    return chat.users.find((user) => user.id !== selfId) ?? chat.users[0] ?? null;
  }

  function isOwn(message: WfmChatMessage, chat: WfmChat | null): boolean {
    if (selfId) return message.fromUserId === selfId;
    // Until /me answers: whoever is not the chat partner is us.
    const other = chat ? partner(chat) : null;
    return !!other && message.fromUserId !== other.id;
  }

  function avatarUrl(avatar: string | null): string | null {
    return avatar ? `https://warframe.market/static/assets/${avatar}` : null;
  }

  /** Chat list: time today, date otherwise. Bubbles (`full`): date and time unless today. */
  function formatTime(iso: string, full = false): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const sameDay = date.toDateString() === new Date().toDateString();
    const day = date.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
    const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    if (sameDay) return time;
    return full ? `${day} ${time}` : day;
  }

  async function scrollToEnd(): Promise<void> {
    await tick();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  async function refresh(): Promise<void> {
    refreshing = true;
    error = null;
    try {
      const result = await invoke("wfmChatRefresh");
      if (result.ok) setWfmChatState(result.state);
      else error = result.error;
    } finally {
      refreshing = false;
    }
  }

  async function openChat(chatId: string): Promise<void> {
    activeId = chatId;
    messages = [];
    error = null;
    loadingMessages = true;
    void invoke("wfmChatSetActive", chatId);
    try {
      const result = await invoke("wfmChatMessages", chatId);
      if (activeId !== chatId) return;
      if (result.ok) messages = result.messages;
      else error = result.error;
    } finally {
      if (activeId === chatId) loadingMessages = false;
    }
    await scrollToEnd();
  }

  function closeChat(): void {
    activeId = null;
    messages = [];
    void invoke("wfmChatSetActive", null);
  }

  async function sendDraft(): Promise<void> {
    const text = draft.trim();
    if (!text || !activeId || sending) return;
    sending = true;
    error = null;
    try {
      const result = await invoke("wfmChatSend", { chatId: activeId, text });
      if (result.ok) draft = "";
      else error = result.error;
    } finally {
      sending = false;
    }
  }

  async function deleteChat(chat: WfmChat): Promise<void> {
    const confirmed = await confirmWithDialog(
      $tr("messages.confirmDelete", { name: chat.name }),
      $tr,
    );
    if (!confirmed) return;
    error = null;
    const result = await invoke("wfmChatDelete", chat.id);
    if (!result.ok) {
      error = $tr("messages.deleteFailed", { error: result.error });
      return;
    }
    if (activeId === chat.id) closeChat();
  }

  function onDraftKey(event: KeyboardEvent): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void sendDraft();
  }

  // Coming back to the window with a chat open: fetching it again is what marks
  // the messages that arrived meanwhile as read on warframe.market.
  function onWindowFocus(): void {
    if (activeId && activeChat && activeChat.unreadCount > 0) void openChat(activeId);
  }

  const stopMessages = onWfmChatMessage((message) => {
    if (message.chatId !== activeId) return;
    if (messages.some((entry) => entry.id === message.id)) return;
    messages = [...messages, message];
    void scrollToEnd();
  });

  // Leaving the tab must stop counting the open chat as "on screen".
  $effect(() => {
    if ($currentView !== "messages" && activeId) void invoke("wfmChatSetActive", null);
    else if ($currentView === "messages" && activeId) void invoke("wfmChatSetActive", activeId);
  });

  onMount(() => {
    window.addEventListener("focus", onWindowFocus);
    // Main runs the chat service only behind a live session, so "offline" is signed out.
    if ($wfmChatState.connection !== "offline") void refresh();
  });

  onDestroy(() => {
    window.removeEventListener("focus", onWindowFocus);
    stopMessages();
    void invoke("wfmChatSetActive", null);
  });
</script>

<section class="view active" data-messages-view>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="m-0 text-lg font-semibold text-text-primary">{$tr("messages.title")}</h2>
      <span
        class="msg-conn"
        data-state={$wfmChatState.connection}
        data-messages-connection={$wfmChatState.connection}
      >
        {$tr(CONNECTION_KEYS[$wfmChatState.connection])}
      </span>
      <div class="ml-auto flex items-center gap-2">
        <button
          type="button"
          class="btn-secondary btn-sm"
          disabled={refreshing || $wfmChatState.connection === "offline"}
          onclick={refresh}
          data-messages-refresh
        >
          {$tr("messages.refresh")}
        </button>
      </div>
    </div>

    {#if $wfmChatState.connection === "offline"}
      <p
        class="m-0 rounded-lg border border-border bg-bg-deep p-3 text-sm text-text-secondary"
        data-messages-signed-out
      >
        {$tr("messages.signedOut")}
      </p>
    {/if}

    {#if error}
      <p
        class="m-0 rounded-md border border-border px-3 py-2 text-sm text-danger"
        data-messages-error
      >
        {error}
      </p>
    {/if}

    <div class="msg-layout">
      <aside class="msg-list" data-messages-list>
        <input
          type="search"
          class="msg-search"
          placeholder={$tr("messages.search")}
          bind:value={search}
        />
        <ul class="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
          {#each chats as chat (chat.id)}
            {@const other = partner(chat)}
            <li>
              <div
                class="msg-chat"
                class:active={chat.id === activeId}
                data-messages-chat={chat.id}
              >
                <button type="button" class="msg-chat-main" onclick={() => openChat(chat.id)}>
                  <span class="msg-avatar">
                    {#if avatarUrl(other?.avatar ?? null)}
                      <img src={avatarUrl(other?.avatar ?? null)} alt="" loading="lazy" />
                    {:else}
                      {chat.name.slice(0, 1).toUpperCase()}
                    {/if}
                    <span class="msg-status" data-status={other?.status ?? "offline"}></span>
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="flex items-baseline gap-2">
                      <span class="min-w-0 flex-1 truncate font-semibold text-text-primary"
                        >{chat.name}</span
                      >
                      <span class="shrink-0 text-xs text-text-muted"
                        >{formatTime(chat.lastUpdate)}</span
                      >
                    </span>
                    <span class="flex items-center gap-2">
                      <span class="min-w-0 flex-1 truncate text-xs text-text-secondary">
                        {chat.lastMessage?.text ?? ""}
                      </span>
                      {#if chat.unreadCount > 0}
                        <span class="msg-unread" data-messages-unread>{chat.unreadCount}</span>
                      {/if}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  class="msg-delete"
                  title={$tr("messages.delete")}
                  aria-label={$tr("messages.delete")}
                  onclick={() => deleteChat(chat)}
                  data-messages-delete
                >
                  ×
                </button>
              </div>
            </li>
          {:else}
            <li class="p-3 text-sm text-text-muted" data-messages-empty>
              {$tr(search.trim() ? "messages.noMatches" : "messages.empty")}
            </li>
          {/each}
        </ul>
      </aside>

      <div class="msg-thread" data-messages-thread>
        {#if activeChat}
          {@const other = partner(activeChat)}
          <header class="msg-thread-head">
            <span class="min-w-0 flex-1 truncate font-semibold text-text-primary"
              >{activeChat.name}</span
            >
            {#if other}
              <button
                type="button"
                class="btn-secondary btn-sm"
                onclick={() =>
                  send(
                    "open-external",
                    `https://warframe.market/profile/${encodeURIComponent(other.name)}`,
                  )}
              >
                {$tr("messages.openProfile")}
              </button>
              <button
                type="button"
                class="btn-secondary btn-sm"
                title={$tr("messages.copyWhisperHint")}
                onclick={() => void navigator.clipboard.writeText(`/w ${other.name} `)}
              >
                {$tr("messages.copyWhisper")}
              </button>
            {/if}
          </header>
          <div class="msg-scroll" bind:this={scroller}>
            {#if loadingMessages}
              <p class="m-0 p-3 text-sm text-text-muted">{$tr("messages.loading")}</p>
            {/if}
            {#each messages as message (message.id)}
              {@const own = isOwn(message, activeChat)}
              <div class="msg-row" class:own data-messages-message={own ? "own" : "other"}>
                <div class="msg-bubble">
                  <p class="m-0 whitespace-pre-wrap break-words">{message.text}</p>
                  <span class="msg-time">{formatTime(message.sentAt, true)}</span>
                </div>
              </div>
            {/each}
          </div>
          <form
            class="msg-compose"
            onsubmit={(event) => {
              event.preventDefault();
              void sendDraft();
            }}
          >
            <textarea
              rows="2"
              class="msg-input"
              maxlength={WFM_CHAT_MAX_MESSAGE_LENGTH}
              placeholder={$tr("messages.placeholder")}
              bind:value={draft}
              onkeydown={onDraftKey}
              disabled={$wfmChatState.connection !== "online"}
              data-messages-input></textarea>
            <button
              type="submit"
              class="btn-primary btn-sm"
              disabled={sending || !draft.trim() || $wfmChatState.connection !== "online"}
              data-messages-send
            >
              {$tr("messages.send")}
            </button>
          </form>
        {:else}
          <p class="m-auto p-6 text-center text-sm text-text-muted">{$tr("messages.pickChat")}</p>
        {/if}
      </div>
    </div>
  </div>
</section>

<style>
  .msg-layout {
    display: grid;
    /* The view scrolls as a whole, so the chat pane takes the window height itself. */
    height: calc(100vh - 190px);
    min-height: 320px;
    grid-template-columns: minmax(220px, 320px) 1fr;
    gap: 0.75rem;
  }
  .msg-list,
  .msg-thread {
    display: flex;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg-deep);
  }
  .msg-search {
    margin: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: transparent;
    padding: 0.35rem 0.5rem;
    font-size: 0.85rem;
    color: var(--text-primary);
  }
  .msg-chat {
    display: flex;
    align-items: stretch;
    border-left: 3px solid transparent;
  }
  .msg-chat:hover,
  .msg-chat.active {
    background: var(--bg-hover);
  }
  .msg-chat.active {
    border-left-color: var(--accent);
  }
  .msg-chat-main {
    display: flex;
    min-width: 0;
    flex: 1;
    cursor: pointer;
    align-items: center;
    gap: 0.6rem;
    border: 0;
    background: transparent;
    padding: 0.5rem 0.25rem 0.5rem 0.6rem;
    text-align: left;
    font-size: 0.875rem;
    color: inherit;
  }
  .msg-avatar {
    position: relative;
    display: grid;
    height: 2.25rem;
    width: 2.25rem;
    flex-shrink: 0;
    place-items: center;
    border-radius: 999px;
    background: var(--bg-hover);
    font-weight: 700;
    color: var(--text-secondary);
  }
  .msg-avatar img {
    height: 100%;
    width: 100%;
    border-radius: 999px;
    object-fit: cover;
  }
  .msg-status {
    position: absolute;
    right: -1px;
    bottom: -1px;
    height: 0.65rem;
    width: 0.65rem;
    border: 2px solid var(--bg-deep);
    border-radius: 999px;
    background: #6b7280;
  }
  .msg-status[data-status="online"] {
    background: #22c55e;
  }
  .msg-status[data-status="ingame"] {
    background: #a855f7;
  }
  .msg-unread {
    min-width: 1.2rem;
    flex-shrink: 0;
    border-radius: 999px;
    background: var(--accent);
    padding: 0 0.3rem;
    text-align: center;
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 1.2rem;
    color: #111;
  }
  .msg-delete {
    cursor: pointer;
    border: 0;
    background: transparent;
    padding: 0 0.6rem;
    font-size: 1.1rem;
    color: var(--text-muted);
    opacity: 0;
  }
  .msg-chat:hover .msg-delete,
  .msg-delete:focus-visible {
    opacity: 1;
  }
  .msg-delete:hover {
    color: var(--danger, #ef4444);
  }
  .msg-thread-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-bottom: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
  }
  .msg-scroll {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 0.4rem;
    overflow-y: auto;
    padding: 0.75rem;
  }
  .msg-row {
    display: flex;
  }
  .msg-row.own {
    justify-content: flex-end;
  }
  .msg-bubble {
    max-width: min(70%, 40rem);
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    background: var(--bg-hover);
    padding: 0.4rem 0.6rem;
    font-size: 0.875rem;
    color: var(--text-primary);
  }
  .msg-row.own .msg-bubble {
    border-color: var(--accent-dim);
    background: var(--accent-glow);
  }
  .msg-time {
    display: block;
    margin-top: 0.15rem;
    text-align: right;
    font-size: 0.65rem;
    color: var(--text-muted);
  }
  .msg-compose {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    border-top: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
  }
  .msg-input {
    min-width: 0;
    flex: 1;
    resize: none;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    background: transparent;
    padding: 0.4rem 0.5rem;
    font: inherit;
    font-size: 0.875rem;
    color: var(--text-primary);
  }
  .msg-conn {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
    font-size: 0.7rem;
    color: var(--text-muted);
  }
  .msg-conn[data-state="online"] {
    border-color: #22c55e;
    color: #22c55e;
  }
  .msg-conn[data-state="connecting"] {
    border-color: var(--accent);
    color: var(--accent);
  }
  @media (max-width: 760px) {
    .msg-layout {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(140px, 35%) 1fr;
    }
  }
</style>
