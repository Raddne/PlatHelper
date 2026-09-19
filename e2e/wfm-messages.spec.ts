import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  type ElectronTestHarness,
} from "./electronTestHarness";

const message = (id: string, chat: string, from: string, text: string, minute: number) => ({
  id,
  chat_id: chat,
  message: `<p>${text}</p>`,
  raw_message: text,
  send_date: `2026-09-18T10:${String(minute).padStart(2, "0")}:00.000+00:00`,
  message_from: from,
});

const FIXTURE = {
  selfId: "me",
  chats: [
    {
      id: "chatA",
      chat_name: "AlphaTenno",
      unread_count: 2,
      last_update: "2026-09-18T10:05:00.000+00:00",
      chat_with: [{ id: "uA", ingame_name: "AlphaTenno", status: "ingame", avatar: null }],
      messages: [message("a2", "chatA", "uA", "is the Serration still up?", 5)],
    },
    {
      id: "chatB",
      chat_name: "BetaTenno",
      unread_count: 0,
      last_update: "2026-09-18T09:00:00.000+00:00",
      chat_with: [{ id: "uB", ingame_name: "BetaTenno", status: "offline", avatar: null }],
      messages: [message("b1", "chatB", "me", "thanks for the trade", 0)],
    },
  ],
  messages: {
    chatA: [
      message("a1", "chatA", "me", "hello", 1),
      message("a2", "chatA", "uA", "is the Serration still up?", 5),
    ],
    chatB: [message("b1", "chatB", "me", "thanks for the trade", 0)],
  },
};

test.describe("warframe.market messages", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  test.beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-messages-fixture-"));
    const fixturePath = path.join(dir, "chats.json");
    fs.writeFileSync(fixturePath, JSON.stringify(FIXTURE));
    process.env.WFHELPER_WFM_CHAT_FIXTURES = fixturePath;
    harness = await launchElectronTestHarness("wfh-messages-e2e-", {
      eeLog:
        "0.127 Sys [Diag]: Current time: Fri Sep 18 15:40:49 2026 [UTC: Fri Sep 18 21:40:49 2026]\r\n",
    });
    page = harness.page;
  });

  test.afterAll(async () => {
    delete process.env.WFHELPER_WFM_CHAT_FIXTURES;
    await closeElectronTestHarness(harness);
  });

  test("the sidebar row counts unread messages", async () => {
    await expect(page.locator('#sidebar [data-view="messages"] [data-sidebar-unread]')).toHaveText(
      "2",
    );
  });

  test("the chat list shows every chat, newest first, and the search filters it", async () => {
    await openView(page, "messages");
    const rows = page.locator("[data-messages-chat]");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("AlphaTenno");
    await expect(rows.first().locator("[data-messages-unread]")).toHaveText("2");
    await page.locator("[data-messages-list] input").fill("beta");
    await expect(rows).toHaveCount(1);
    await page.locator("[data-messages-list] input").fill("");
    await expect(page.locator("[data-messages-connection]")).toHaveAttribute(
      "data-messages-connection",
      "online",
    );
  });

  test("opening a chat loads its history, tells sides apart and marks it read", async () => {
    await page.locator('[data-messages-chat="chatA"] button').first().click();
    const bubbles = page.locator("[data-messages-message]");
    await expect(bubbles).toHaveCount(2);
    await expect(bubbles.nth(0)).toHaveAttribute("data-messages-message", "own");
    await expect(bubbles.nth(1)).toHaveAttribute("data-messages-message", "other");
    await expect(page.locator('[data-messages-chat="chatA"] [data-messages-unread]')).toHaveCount(
      0,
    );
    await expect(page.locator("[data-sidebar-unread]")).toHaveCount(0);
  });

  test("a sent message appears in the thread and as the chat preview", async () => {
    await page.locator("[data-messages-input]").fill("yes, 45p");
    await page.locator("[data-messages-input]").press("Enter");
    await expect(page.locator("[data-messages-message]")).toHaveCount(3);
    await expect(page.locator("[data-messages-message]").last()).toContainText("yes, 45p");
    await expect(page.locator("[data-messages-input]")).toHaveValue("");
    await expect(page.locator('[data-messages-chat="chatA"]')).toContainText("yes, 45p");
  });

  test("an incoming message rings the notification sound from Settings and counts as unread", async () => {
    await page.evaluate(() => {
      const w = window as unknown as {
        __sounds: unknown[];
        api: { onNotificationSoundPlay: (cb: (p: unknown) => void) => void };
      };
      w.__sounds = [];
      w.api.onNotificationSoundPlay((payload) => w.__sounds.push(payload));
    });
    await page.locator("[data-messages-input]").fill("/echo on my way");
    await page.locator("[data-messages-send]").click();
    await expect(page.locator("[data-messages-message]").last()).toContainText("on my way");
    await expect(page.locator("[data-messages-message]").last()).toHaveAttribute(
      "data-messages-message",
      "other",
    );
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __sounds: unknown[] }).__sounds))
      .toEqual([{ volume: 1, revision: null }]);
  });

  test("a new in-game whisper tab in EE.log rings the notification sound", async () => {
    await page.evaluate(() => {
      (window as unknown as { __sounds: unknown[] }).__sounds = [];
    });
    // The shared notification sound rings at most once per 3 s burst.
    await page.waitForTimeout(3_200);
    const logDir = path.join(harness.sandboxDir, "local", "Warframe");
    const line =
      "1234.567 Script [Info]: ChatRedux.lua: ChatRedux::AddTab: Adding tab with channel name: FSomeTenno to index 5\r\n";
    // Re-appended while polling; the per-sender debounce keeps it to one notification.
    await expect
      .poll(
        () => {
          fs.appendFileSync(path.join(logDir, "EE.log"), line);
          return page.evaluate(() => (window as unknown as { __sounds: unknown[] }).__sounds);
        },
        { timeout: 60_000, intervals: [2_000] },
      )
      .toEqual([{ volume: 1, revision: null }]);
  });

  test("deleting a chat asks first and removes it on confirm", async () => {
    const row = page.locator('[data-messages-chat="chatB"]');
    await evaluateInMain(harness.app, ({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never;
    });
    await row.hover();
    await row.locator("[data-messages-delete]").click();
    await page.waitForTimeout(400);
    await expect(row).toHaveCount(1);

    await evaluateInMain(harness.app, ({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as never;
    });
    await row.locator("[data-messages-delete]").click();
    await expect(row).toHaveCount(0);
    await expect(page.locator("[data-messages-error]")).toHaveCount(0);
  });
});
