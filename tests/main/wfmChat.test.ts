import { describe, expect, it } from "vitest";

import {
  applyWfmChatMessage,
  isWfmChatId,
  normalizeWfmChat,
  normalizeWfmChatList,
  normalizeWfmChatMessage,
  totalUnread,
} from "../../config/shared/wfmChat";

const RAW_CHAT = {
  id: "chat1",
  chat_name: "Tenno",
  unread_count: 2,
  last_update: "2026-09-18T10:00:00.000+00:00",
  chat_with: [{ id: "u2", ingame_name: "Tenno", status: "ingame", avatar: "user/a.png" }],
  messages: [
    {
      id: "m1",
      chat_id: "chat1",
      message: "<p>hi</p>",
      raw_message: "hi",
      send_date: "2026-09-18T10:00:00.000+00:00",
      message_from: "u2",
    },
  ],
};

describe("wfmChat normalizers", () => {
  it("maps a warframe.market chat onto the app shape", () => {
    expect(normalizeWfmChat(RAW_CHAT)).toEqual({
      id: "chat1",
      name: "Tenno",
      users: [{ id: "u2", name: "Tenno", status: "ingame", avatar: "user/a.png" }],
      unreadCount: 2,
      lastUpdate: "2026-09-18T10:00:00.000+00:00",
      lastMessage: {
        id: "m1",
        chatId: "chat1",
        text: "hi",
        sentAt: "2026-09-18T10:00:00.000+00:00",
        fromUserId: "u2",
      },
    });
  });

  it("drops malformed rows instead of throwing", () => {
    expect(normalizeWfmChatList([null, 5, { chat_name: "no id" }, RAW_CHAT])).toHaveLength(1);
    expect(normalizeWfmChatList("nope")).toEqual([]);
    expect(normalizeWfmChatMessage({ id: "m" })).toBeNull();
  });

  it("falls back to stripped html and to the supplied chat id", () => {
    const message = normalizeWfmChatMessage({ id: "m2", message: "<b>yo</b> there" }, "chat9");
    expect(message).toMatchObject({ chatId: "chat9", text: "yo there" });
  });

  it("sorts the list by last activity, newest first", () => {
    const older = { ...RAW_CHAT, id: "old", last_update: "2026-09-01T00:00:00.000+00:00" };
    expect(normalizeWfmChatList([older, RAW_CHAT]).map((chat) => chat.id)).toEqual([
      "chat1",
      "old",
    ]);
  });

  it("only accepts plain ids, so an id can never reshape a request path", () => {
    expect(isWfmChatId("5f3a9c_x-1")).toBe(true);
    expect(isWfmChatId("../me")).toBe(false);
    expect(isWfmChatId("")).toBe(false);
    expect(isWfmChatId(7)).toBe(false);
  });
});

describe("applyWfmChatMessage", () => {
  const chats = normalizeWfmChatList([RAW_CHAT]);
  const incoming = {
    id: "m2",
    chatId: "chat1",
    text: "still there?",
    sentAt: "2026-09-18T11:00:00.000+00:00",
    fromUserId: "u2",
  };

  it("counts a message from the other side as unread", () => {
    const next = applyWfmChatMessage(chats, incoming, { activeChatId: null, selfId: "me" });
    expect(next?.[0]).toMatchObject({
      unreadCount: 3,
      lastMessage: incoming,
      lastUpdate: incoming.sentAt,
    });
    expect(totalUnread(next ?? [])).toBe(3);
  });

  it("does not count the chat that is open on screen, nor our own messages", () => {
    expect(
      applyWfmChatMessage(chats, incoming, { activeChatId: "chat1", selfId: "me" })?.[0]
        ?.unreadCount,
    ).toBe(2);
    expect(
      applyWfmChatMessage(
        chats,
        { ...incoming, fromUserId: "me" },
        { activeChatId: null, selfId: "me" },
      )?.[0]?.unreadCount,
    ).toBe(2);
  });

  it("ignores a push it has already folded in", () => {
    const once = applyWfmChatMessage(chats, incoming, { activeChatId: null, selfId: "me" }) ?? [];
    expect(
      applyWfmChatMessage(once, incoming, { activeChatId: null, selfId: "me" })?.[0]?.unreadCount,
    ).toBe(3);
  });

  it("reports an unknown chat so the caller refetches the list", () => {
    expect(
      applyWfmChatMessage(
        chats,
        { ...incoming, chatId: "new" },
        { activeChatId: null, selfId: "me" },
      ),
    ).toBeNull();
  });
});
