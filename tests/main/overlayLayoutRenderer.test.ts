import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_OVERLAY_FIELD_STYLE } from "../../config/shared/overlayLayout";

const source = readFileSync("renderer/reward-layout.js", "utf8");

function fixture(preview: boolean, zoom: number, fieldTop = 10, offset = 12) {
  const events = new Map<string, (event: unknown) => void>();
  const frames: Array<() => void> = [];
  const classes = new Set<string>();
  const classList = {
    toggle: (name: string, enabled: boolean) => {
      if (enabled) classes.add(name);
      else classes.delete(name);
    },
  };
  const rect = (left: number, top: number, width: number, height: number) => ({
    left: left * zoom,
    top: top * zoom,
    right: (left + width) * zoom,
    bottom: (top + height) * zoom,
    width: width * zoom,
    height: height * zoom,
  });
  const element = {
    dataset: { rewardField: "itemName" },
    classList,
    style: { backgroundColor: "", translate: "", scale: "", setProperty: vi.fn() },
    querySelector: () => null,
    getClientRects: () => [1],
    closest: () => element,
    setPointerCapture: vi.fn(),
    getBoundingClientRect: () => rect(10, fieldTop, 20, 10),
  };
  let panelWidth = 100;
  const root = {
    tabIndex: 0,
    focus: vi.fn(),
    querySelectorAll: () => [element],
    getBoundingClientRect: () => rect(0, 0, panelWidth, 80),
  };
  let receive: ((state: unknown) => void) | undefined;
  const editLayout = vi.fn();
  const document = {
    body: { classList },
    getElementById: () => root,
    fonts: { ready: Promise.resolve() },
    addEventListener: (name: string, listener: (event: unknown) => void) =>
      events.set(name, listener),
  };
  const window: Record<string, unknown> = {
    addEventListener: (name: string, listener: (event: unknown) => void) =>
      events.set(name, listener),
    overlayLayoutApi: {
      onLayout: (listener: (state: unknown) => void) => (receive = listener),
      getLayout: () => Promise.resolve(null),
      editLayout,
    },
  };
  window.parent = preview ? {} : window;
  runInNewContext(source, {
    window,
    document,
    location: { search: "?mode=editor" },
    URLSearchParams,
    structuredClone,
    Element: Object,
    getComputedStyle: () => ({ zoom: String(zoom), translate: element.style.translate || "none" }),
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
    cancelAnimationFrame: vi.fn(),
    MutationObserver: class {
      observe() {}
    },
  });
  const install = window.installOverlayLayout as (options: unknown) => { isEditing: () => boolean };
  const editor = install({
    defaultFieldStyle: DEFAULT_OVERLAY_FIELD_STYLE,
    boundsFor:
      fieldTop > 80 ? () => ({ getBoundingClientRect: () => rect(0, 100, 100, 30) }) : undefined,
  });
  const initial = {
    kind: "tradeNotification",
    sessionId: "token",
    revision: 1,
    layout: {
      version: 1,
      fields: { itemName: { ...DEFAULT_OVERLAY_FIELD_STYLE, x: offset, y: 5, scale: 2 } },
    },
    selectedField: "itemName",
    previewCount: 1,
    previewVariant: "sale",
  };
  receive?.(initial);
  while (frames.length) frames.shift()?.();
  return {
    editor,
    root,
    element,
    classes,
    editLayout,
    events,
    initial,
    receive,
    frames,
    resize: (width: number) => {
      panelWidth = width;
      events.get("resize")?.({});
      while (frames.length) frames.shift()?.();
    },
  };
}

describe("shared overlay renderer", () => {
  it.each([
    ["ArrowRight", false, { x: 13, y: 5 }],
    ["ArrowDown", true, { x: 12, y: 15 }],
  ])("nudges the selected field with %s and shift=%s", (key, shiftKey, patch) => {
    const view = fixture(true, 1);
    const preventDefault = vi.fn();
    view.events.get("keydown")?.({ key, shiftKey, target: null, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(view.editLayout).toHaveBeenCalledExactlyOnceWith("token", {
      type: "field",
      field: "itemName",
      patch,
    });
  });

  it("does not nudge live overlays or intercept arrow keys in an input", () => {
    for (const preview of [false, true]) {
      const view = fixture(preview, 1);
      const preventDefault = vi.fn();
      view.events.get("keydown")?.({ key: "ArrowRight", target: view.element, preventDefault });
      expect(preventDefault).not.toHaveBeenCalled();
      expect(view.editLayout).not.toHaveBeenCalled();
    }
  });
  it("accepts a selection acknowledgement while dragging a field with default geometry", () => {
    const view = fixture(true, 1);
    const defaults = { ...view.initial, revision: 2, layout: { version: 1, fields: {} } };
    view.receive?.(defaults);
    while (view.frames.length) view.frames.shift()?.();
    view.events.get("pointerdown")?.({
      target: view.element,
      button: 0,
      clientX: 12,
      clientY: 12,
      pointerId: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    expect(() => view.receive?.({ ...defaults, revision: 3 })).not.toThrow();
    expect(view.element.setPointerCapture).toHaveBeenCalledWith(1);
    expect(view.root.tabIndex).toBe(-1);
    expect(view.root.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(view.editLayout).toHaveBeenCalledExactlyOnceWith("token", {
      type: "select",
      field: "itemName",
    });
  });

  it("clamps saved offsets visually without writing them on open, preview changes or resize", () => {
    const view = fixture(true, 1, 10, 500);
    expect(view.element.style.translate).toBe("47px 5px");
    expect(view.editLayout).not.toHaveBeenCalled();
    view.receive?.({ ...view.initial, revision: 2, previewVariant: "purchase" });
    while (view.frames.length) view.frames.shift()?.();
    expect(view.element.style.translate).toBe("47px 5px");
    expect(view.editLayout).not.toHaveBeenCalled();
    view.resize(80);
    expect(view.element.style.translate).toBe("27px 5px");
    expect(view.editLayout).not.toHaveBeenCalled();
    expect(view.initial.layout.fields.itemName.x).toBe(500);
  });

  it("saves the rendered clamp after an explicit geometry edit", () => {
    const view = fixture(true, 1);
    view.receive?.({
      ...view.initial,
      revision: 2,
      layout: {
        version: 1,
        fields: { itemName: { ...DEFAULT_OVERLAY_FIELD_STYLE, x: 500, y: 5, scale: 2 } },
      },
    });
    while (view.frames.length) view.frames.shift()?.();
    expect(view.editLayout).toHaveBeenCalledExactlyOnceWith("token", {
      type: "field",
      field: "itemName",
      patch: { x: 47, y: 5 },
    });
  });

  it("retains an unresolved geometry edit until its hidden field becomes visible", () => {
    const view = fixture(true, 1);
    const edited = {
      ...view.initial,
      revision: 2,
      layout: {
        version: 1,
        fields: {
          itemName: { ...DEFAULT_OVERLAY_FIELD_STYLE, x: 500, y: 5, scale: 2, hidden: true },
        },
      },
    };
    view.receive?.(edited);
    while (view.frames.length) view.frames.shift()?.();
    expect(view.editLayout).not.toHaveBeenCalled();

    edited.revision = 3;
    edited.layout.fields.itemName.hidden = false;
    view.receive?.(edited);
    while (view.frames.length) view.frames.shift()?.();
    expect(view.editLayout).toHaveBeenCalledExactlyOnceWith("token", {
      type: "field",
      field: "itemName",
      patch: { x: 47, y: 5 },
    });
  });

  it("uses logical offsets at the trade toast's native zoom", () => {
    const normal = fixture(false, 1);
    const zoomed = fixture(false, 1.5);
    expect(zoomed.element.style.translate).toBe("12px 5px");
    expect(zoomed.element.style.translate).toBe(normal.element.style.translate);
    expect(zoomed.element.style.scale).toBe("2");
  });

  it("never enables editor input in a top-level live window, even with a token", () => {
    const live = fixture(false, 1.5);
    expect(live.editor.isEditing()).toBe(false);
    expect(live.classes.has("reward-layout-editing")).toBe(false);
    expect(live.editLayout).not.toHaveBeenCalled();
    expect(fixture(true, 1).editor.isEditing()).toBe(true);
  });

  it("does not clamp fields in an offscreen repeated card into negative bounds", () => {
    const offscreen = fixture(true, 1, 110);
    expect(offscreen.element.style.translate).toBe("");
    expect(offscreen.editLayout).not.toHaveBeenCalled();
    expect(offscreen.events.has("scroll")).toBe(true);
  });
});
