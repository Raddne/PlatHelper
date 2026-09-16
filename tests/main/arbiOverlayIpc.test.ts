import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARBI_SUMMARY_CLOSE, ARBI_SUMMARY_READY } from "../../config/shared/ipcChannels";

const state = vi.hoisted(() => ({
  visible: true,
  handlers: new Map<string, (event: { sender: { id: number } }) => void>(),
  mouse: vi.fn(),
  focusable: vi.fn(),
  ready: vi.fn(() => true),
}));

vi.mock("electron", () => ({ app: { getAppPath: () => "D:/app" }, BrowserWindow: {}, screen: {} }));
vi.mock("../../services/logger", () => ({ withScope: () => ({ info: vi.fn(), warn: vi.fn() }) }));
vi.mock("../../services/windowSecurity", () => ({ hardenBrowserWindowNavigation: vi.fn() }));
vi.mock("../../ipc/context", () => ({
  default: {
    arbiSummaryWindow: { isDestroyed: () => false, setFocusable: state.focusable },
    overlaySettings: {},
  },
}));
vi.mock("../../ipc/overlay/clickThrough", () => ({ setClickThrough: state.mouse }));
vi.mock("../../ipc/ipcSecurity", () => ({
  assertArbiSummarySender: vi.fn(),
  onAuthorized: (
    channel: string,
    _guard: unknown,
    handler: (event: { sender: { id: number } }) => void,
  ) => {
    state.handlers.set(channel, handler);
  },
}));
vi.mock("../../ipc/overlay/windows", () => ({
  createOverlayWindowBoundsChangeHandler: () => vi.fn(),
  createOverlayWindowsController: () => ({
    isOverlayWindowVisible: () => state.visible,
    isKeepMappedActive: () => true,
    clearOverlayAutoHideTimer: vi.fn(),
    hideOverlayWindow: () => {
      state.visible = false;
    },
    markRendererReady: state.ready,
  }),
}));

import { register } from "../../ipc/arbiOverlayIpc";

describe("arbitration overlay readiness", () => {
  beforeEach(() => {
    state.visible = true;
    state.mouse.mockClear();
    state.focusable.mockClear();
    state.ready.mockClear();
    state.handlers.clear();
    register();
  });

  it("cannot restore clicks when READY arrives after close", () => {
    const event = { sender: { id: 1 } };
    state.handlers.get(ARBI_SUMMARY_CLOSE)!(event);
    state.handlers.get(ARBI_SUMMARY_READY)!(event);
    expect(state.ready).toHaveBeenCalledWith(1);
    expect(state.mouse).toHaveBeenCalledExactlyOnceWith(expect.anything(), true);
    expect(state.focusable).toHaveBeenLastCalledWith(false);
  });

  it("restores clicks after a visible renderer reload", () => {
    state.handlers.get(ARBI_SUMMARY_READY)!({ sender: { id: 1 } });
    expect(state.mouse).toHaveBeenCalledWith(expect.anything(), false);
  });
});
