<script lang="ts">
  import { onMount } from "svelte";
  import { flip } from "svelte/animate";
  import { fade, scale } from "svelte/transition";
  import { currentView } from "../stores/app.js";
  import { invoke, send } from "../lib/ipc.js";
  import { tr } from "../lib/i18n.js";
  import { NAV_ICON_URLS } from "../lib/assetUrls.js";
  import { devMode } from "../stores/devMode.js";
  import {
    hiddenTabs,
    nudgeSidebarWidth,
    resetSidebarWidth,
    sidebarCollapsed,
    sidebarLabels,
    sidebarOrder,
    sidebarWidth,
    snapSidebarWidth,
    toggleSidebarCollapsed,
    SIDEBAR_EXPAND_MIN,
    SIDEBAR_RAIL_WIDTH,
    SIDEBAR_WIDTH_MAX,
  } from "../stores/sidebarTabs.js";
  import {
    sidebarGroupAssignment,
    sidebarGroupMeta,
    groupViews,
    addToGroup,
    removeFromGroup,
    renameGroup,
    toggleGroupCollapsed,
    ungroupAll,
    SIDEBAR_GROUP_NAME_MAX,
  } from "../stores/sidebarGroups.js";
  import { resetTourAutoStart } from "../stores/tour.js";
  import type { MessageKey } from "../lib/i18n.js";
  import { VIEW_LABEL_KEYS, type SidebarViewName } from "../lib/viewRegistry.js";
  import FeedbackModal from "./FeedbackModal.svelte";
  import PresetManagerModal from "../modals/PresetManagerModal.svelte";
  import { wfmChatUnread } from "../stores/wfmChat.js";
  import {
    canGroupOnto,
    normalizeOrder,
    planDrop,
    zoneAt,
    type DragSubject,
    type DropPlan,
    type DropZone,
    type SidebarRow,
  } from "../lib/sidebarDrop.js";

  $: showDevTools = $devMode;
  let feedbackOpen = false;
  let customizeOpen = false;

  interface NavItem {
    view: SidebarViewName;
    labelKey: MessageKey;
    icon: string;
  }

  $: navItems = $sidebarOrder.map(
    (view): NavItem => ({ view, labelKey: VIEW_LABEL_KEYS[view], icon: NAV_ICON_URLS[view] }),
  );

  $: visibleNavItems = navItems.filter((item) => !$hiddenTabs.has(item.view));

  // Inventory and settings are always reachable and never part of a group or
  // reorderable - same fixed-row rule the preset wizard already applies.
  const FIXED_VIEWS = new Set<SidebarViewName>(["inventory", "settings"]);

  type FlatRow =
    | { kind: "view"; key: string; item: NavItem; groupId: string | null }
    | { kind: "group"; key: string; id: string; name: string; collapsed: boolean; count: number };

  // One flat keyed list (group header, then its members) instead of nested
  // blocks: a row that joins or leaves a group keeps its element, so the FLIP
  // animation covers every kind of move. A group sits where its first visible
  // member is; members need not be contiguous in sidebarOrder for that.
  $: flatRows = ((): FlatRow[] => {
    const rows: FlatRow[] = [];
    const visible = new Set(visibleNavItems.map((item) => item.view));
    const byView = new Map(visibleNavItems.map((item) => [item.view, item]));
    for (const view of normalizeOrder($sidebarOrder, $sidebarGroupAssignment)) {
      if (!visible.has(view)) continue;
      const item = byView.get(view) as NavItem;
      const groupId = $sidebarGroupAssignment[view];
      const meta = groupId ? $sidebarGroupMeta[groupId] : undefined;
      if (!groupId || !meta) {
        rows.push({ kind: "view", key: `view:${view}`, item, groupId: null });
        continue;
      }
      if (!rows.some((row) => row.kind === "group" && row.id === groupId)) {
        const count = visibleNavItems.filter(
          (i) => $sidebarGroupAssignment[i.view] === groupId,
        ).length;
        rows.push({
          kind: "group",
          key: `group:${groupId}`,
          id: groupId,
          name: meta.name,
          collapsed: meta.collapsed,
          count,
        });
      }
      if (!meta.collapsed) rows.push({ kind: "view", key: `view:${view}`, item, groupId });
    }
    return rows;
  })();

  // Drag-and-drop with Pointer Events (global capture-phase listeners, like
  // src/lib/listDrag.ts). Nothing is reordered while a row is in hand: the
  // pointer only selects an intent - an insertion line at a row's edge, or a
  // highlight on its middle for grouping - and the single resulting change is
  // applied on release (src/lib/sidebarDrop.ts). Rows therefore never move
  // under the pointer, and the one reflow animates from rest.
  const DRAG_THRESHOLD_PX = 5;
  // Past this distance to the side of the sidebar a release cancels the drag.
  const DRAG_CANCEL_DISTANCE_PX = 140;
  const AUTOSCROLL_EDGE_PX = 24;
  const AUTOSCROLL_STEP_PX = 6;

  interface DropIntent {
    target: SidebarRow<SidebarViewName>;
    key: string;
    zone: DropZone;
    plan: DropPlan<SidebarViewName>;
  }

  let dragSubject: DragSubject<SidebarViewName> | null = null;
  let dragPointerId: number | null = null;
  let navDragStartX = 0;
  let navDragStartY = 0;
  let dragActive = false;
  let dropIntent: DropIntent | null = null;
  let dropLine: { top: number; left: number; width: number } | null = null;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let scrollerEl: HTMLDivElement | null = null;
  let autoScrollFrame: number | null = null;
  let editingGroupId: string | null = null;

  // Cursor-following ghost - written straight to the DOM (rAF-batched) rather
  // than through Svelte state, so a drag doesn't re-render the component on
  // every pointermove; matches the width-grip's applyWidthVar pattern below.
  let ghostEl: HTMLDivElement | null = null;
  let ghostFrame: number | null = null;
  let pendingGhostX = 0;
  let pendingGhostY = 0;
  // Set once per drag, purely to give the ghost's first paint the right position.
  let ghostInitialX = 0;
  let ghostInitialY = 0;
  let ghostLabel = "";
  let ghostIcon: string | null = null;

  function ghostContentFor(subject: DragSubject<SidebarViewName>): {
    label: string;
    icon: string | null;
  } {
    if (subject.kind === "view") {
      const item = navItems.find((n) => n.view === subject.view);
      if (!item) return { label: "", icon: null };
      return { label: $sidebarLabels[item.view] ?? $tr(item.labelKey), icon: item.icon };
    }
    return { label: $sidebarGroupMeta[subject.id]?.name ?? "", icon: null };
  }

  function moveGhostTo(x: number, y: number): void {
    pendingGhostX = x;
    pendingGhostY = y;
    if (ghostFrame !== null) return;
    ghostFrame = requestAnimationFrame(() => {
      ghostFrame = null;
      ghostEl?.style.setProperty(
        "transform",
        `translate3d(${pendingGhostX + 14}px, ${pendingGhostY + 14}px, 0)`,
      );
    });
  }

  function dropRowOf(row: FlatRow): SidebarRow<SidebarViewName> {
    return row.kind === "view"
      ? {
          kind: "view",
          view: row.item.view,
          groupId: row.groupId,
          fixed: FIXED_VIEWS.has(row.item.view),
        }
      : { kind: "group", id: row.id, collapsed: row.collapsed };
  }

  /** The row the pointer's height selects. Only Y counts, so a wobble to the
   *  side never loses the target; gaps and the space past either end resolve to
   *  the nearest row's edge. */
  function rowAtY(y: number): { row: FlatRow; rect: DOMRect; relativeY: number } | null {
    if (!scrollerEl) return null;
    let best: { row: FlatRow; rect: DOMRect; relativeY: number; distance: number } | null = null;
    for (const el of scrollerEl.querySelectorAll<HTMLElement>("[data-sidebar-row]")) {
      const row = flatRows.find((candidate) => candidate.key === el.dataset.sidebarRow);
      if (!row) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) continue;
      const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
      if (best && best.distance <= distance) continue;
      const relativeY = Math.min(1, Math.max(0, (y - rect.top) / rect.height));
      best = { row, rect, relativeY, distance };
    }
    return best;
  }

  function updateDropIntent(): void {
    dropIntent = null;
    dropLine = null;
    const subject = dragSubject;
    const bounds = scrollerEl?.getBoundingClientRect();
    if (!subject || !bounds) return;
    if (
      lastPointerX < bounds.left - DRAG_CANCEL_DISTANCE_PX ||
      lastPointerX > bounds.right + DRAG_CANCEL_DISTANCE_PX
    )
      return;
    const hit = rowAtY(lastPointerY);
    if (!hit) return;
    const target = dropRowOf(hit.row);
    const zone = zoneAt(hit.relativeY, canGroupOnto(subject, target, $sidebarGroupAssignment));
    const plan = planDrop($sidebarOrder, $sidebarGroupAssignment, subject, target, zone);
    if (!plan) return;
    dropIntent = { target, key: hit.row.key, zone, plan };
    if (zone === "center") return;
    // Indented when the row will land inside a group, flush otherwise.
    const indent = plan.joinGroup ? 18 : 0;
    const top = Math.min(
      Math.max(zone === "before" ? hit.rect.top : hit.rect.bottom, bounds.top),
      bounds.bottom,
    );
    dropLine = { top, left: hit.rect.left + indent, width: hit.rect.width - indent };
  }

  function stepAutoScroll(): void {
    autoScrollFrame = null;
    const bounds = scrollerEl?.getBoundingClientRect();
    if (!dragActive || !scrollerEl || !bounds) return;
    const step =
      lastPointerY < bounds.top + AUTOSCROLL_EDGE_PX
        ? -AUTOSCROLL_STEP_PX
        : lastPointerY > bounds.bottom - AUTOSCROLL_EDGE_PX
          ? AUTOSCROLL_STEP_PX
          : 0;
    if (step === 0) return;
    const before = scrollerEl.scrollTop;
    scrollerEl.scrollTop = before + step;
    if (scrollerEl.scrollTop === before) return;
    updateDropIntent();
    autoScrollFrame = requestAnimationFrame(stepAutoScroll);
  }

  function endDrag(): void {
    dragSubject = null;
    dragPointerId = null;
    dragActive = false;
    dropIntent = null;
    dropLine = null;
    ghostLabel = "";
    ghostIcon = null;
    if (ghostFrame !== null) cancelAnimationFrame(ghostFrame);
    if (autoScrollFrame !== null) cancelAnimationFrame(autoScrollFrame);
    ghostFrame = null;
    autoScrollFrame = null;
    window.removeEventListener("pointermove", onSidebarDragMove, true);
    window.removeEventListener("pointerup", onSidebarDragUp, true);
    window.removeEventListener("pointercancel", onSidebarDragCancel, true);
    window.removeEventListener("keydown", onSidebarDragKey, true);
    window.removeEventListener("blur", endDrag);
  }

  function startDrag(subject: DragSubject<SidebarViewName>, e: PointerEvent): void {
    if (e.button !== 0) return;
    endDrag();
    dragSubject = subject;
    dragPointerId = e.pointerId;
    navDragStartX = e.clientX;
    navDragStartY = e.clientY;
    const content = ghostContentFor(subject);
    ghostLabel = content.label;
    ghostIcon = content.icon;
    ghostInitialX = e.clientX;
    ghostInitialY = e.clientY;
    pendingGhostX = e.clientX;
    pendingGhostY = e.clientY;
    window.addEventListener("pointermove", onSidebarDragMove, true);
    window.addEventListener("pointerup", onSidebarDragUp, true);
    window.addEventListener("pointercancel", onSidebarDragCancel, true);
    window.addEventListener("keydown", onSidebarDragKey, true);
    window.addEventListener("blur", endDrag);
    e.preventDefault();
  }

  function onRowPointerDown(view: SidebarViewName, e: PointerEvent): void {
    if (FIXED_VIEWS.has(view)) return;
    startDrag({ kind: "view", view }, e);
  }

  function onGroupHeaderPointerDown(id: string, e: PointerEvent): void {
    startDrag({ kind: "group", id }, e);
  }

  function onSidebarDragMove(e: PointerEvent): void {
    if (dragSubject === null || e.pointerId !== dragPointerId) return;
    if (!dragActive) {
      if (Math.hypot(e.clientX - navDragStartX, e.clientY - navDragStartY) < DRAG_THRESHOLD_PX)
        return;
      dragActive = true;
    }
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    moveGhostTo(e.clientX, e.clientY);
    updateDropIntent();
    if (autoScrollFrame === null) autoScrollFrame = requestAnimationFrame(stepAutoScroll);
  }

  function onSidebarDragCancel(e: PointerEvent): void {
    if (e.pointerId === dragPointerId) endDrag();
  }

  function onSidebarDragKey(e: KeyboardEvent): void {
    if (e.key !== "Escape") return;
    e.preventDefault();
    endDrag();
  }

  function onSidebarDragUp(e: PointerEvent): void {
    if (dragSubject === null || e.pointerId !== dragPointerId) return;
    const subject = dragSubject;
    const wasActive = dragActive;
    const intent = dropIntent;
    endDrag();
    if (!wasActive) {
      if (subject.kind === "view") currentView.set(subject.view);
      else toggleGroupCollapsed(subject.id);
      return;
    }
    if (intent) applyDrop(subject, intent.plan);
  }

  function applyDrop(subject: DragSubject<SidebarViewName>, plan: DropPlan<SidebarViewName>): void {
    const order = $sidebarOrder;
    if (plan.order.length !== order.length || plan.order.some((v, i) => v !== order[i]))
      sidebarOrder.set(plan.order);
    if (subject.kind !== "view") return;
    if (plan.createGroupWith) {
      editingGroupId = groupViews(
        subject.view,
        plan.createGroupWith,
        $tr("nav.newGroupDefaultName"),
      );
    } else if (plan.joinGroup) {
      addToGroup(subject.view, plan.joinGroup);
    } else if (plan.joinGroup === null) {
      removeFromGroup(subject.view);
    }
  }

  function commitRename(id: string, value: string): void {
    renameGroup(id, value);
    editingGroupId = null;
  }

  function onRenameKeydown(id: string, e: KeyboardEvent): void {
    const input = e.currentTarget as HTMLInputElement;
    // The header underneath toggles on Enter and Space; typing must not reach it.
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename(id, input.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      editingGroupId = null;
    }
  }

  function focusOnMount(el: HTMLInputElement): void {
    el.focus();
    el.select();
  }

  // Live drag width, uncommitted: a pointer move must not hit localStorage per frame.
  let dragWidth: number | null = null;
  let resizing = false;
  let dragStartX = 0;
  let dragStartWidth = 0;

  $: effectiveWidth = dragWidth ?? $sidebarWidth;
  // Follows the live drag, not the committed width: labels would otherwise stay
  // rendered while the grip is already past the rail threshold.
  $: collapsed = dragWidth != null ? dragWidth < SIDEBAR_EXPAND_MIN : $sidebarCollapsed;

  const narrowRail = typeof window === "undefined" ? null : window.matchMedia("(max-width: 800px)");

  // Publish the width globally so the content area and any other consumer of
  // var(--sidebar-width) reflow with it. Under 800px responsive.css pins the icon
  // rail, so the inline value is dropped there rather than fighting its :root rule.
  function writeWidthVar(px: number): void {
    const root = document.documentElement.style;
    if (narrowRail?.matches) root.removeProperty("--sidebar-width");
    else root.setProperty("--sidebar-width", `${px}px`);
  }

  // One write per frame while the grip is held: each write relayouts the whole
  // content area, which on the mastery tab is a four-figure card count.
  let widthFrame: number | null = null;
  let pendingWidth = 0;

  function applyWidthVar(px: number): void {
    if (typeof document === "undefined") return;
    pendingWidth = px;
    if (!resizing || typeof requestAnimationFrame !== "function") {
      if (widthFrame !== null) cancelAnimationFrame(widthFrame);
      widthFrame = null;
      writeWidthVar(px);
      return;
    }
    if (widthFrame !== null) return;
    widthFrame = requestAnimationFrame(() => {
      widthFrame = null;
      writeWidthVar(pendingWidth);
    });
  }

  $: applyWidthVar(effectiveWidth);

  onMount(() => {
    const onBreakpoint = (): void => applyWidthVar(effectiveWidth);
    narrowRail?.addEventListener("change", onBreakpoint);
    return () => {
      narrowRail?.removeEventListener("change", onBreakpoint);
      if (widthFrame !== null) cancelAnimationFrame(widthFrame);
    };
  });

  function startResize(e: PointerEvent): void {
    // Only the primary button drags; a right- or middle-click would otherwise
    // capture the pointer and never see a matching pointerup.
    if (e.button !== 0) return;
    resizing = true;
    dragStartX = e.clientX;
    dragStartWidth = $sidebarWidth;
    dragWidth = dragStartWidth;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Stops the drag from starting a text selection in the content area.
    e.preventDefault();
  }

  function onResize(e: PointerEvent): void {
    if (!resizing) return;
    dragWidth = snapSidebarWidth(dragStartWidth + (e.clientX - dragStartX));
  }

  function endResize(e: PointerEvent): void {
    if (!resizing) return;
    resizing = false;
    const grip = e.currentTarget as HTMLElement;
    if (grip.hasPointerCapture?.(e.pointerId)) grip.releasePointerCapture(e.pointerId);
    if (dragWidth != null) sidebarWidth.set(dragWidth);
    dragWidth = null;
  }

  function onGripKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft") nudgeSidebarWidth(-step);
    else if (e.key === "ArrowRight") nudgeSidebarWidth(step);
    else if (e.key === "Home") sidebarWidth.set(SIDEBAR_RAIL_WIDTH);
    else if (e.key === "End") sidebarWidth.set(SIDEBAR_WIDTH_MAX);
    else if (e.key === "Enter" || e.key === " ") resetSidebarWidth();
    else return;
    e.preventDefault();
  }

  // If the active tab gets hidden, fall back to inventory so we never strand
  // the user on a view with no way back to it.
  $: if ($hiddenTabs.has($currentView)) currentView.set("inventory");

  async function loadInventoryFile(): Promise<void> {
    // seeds the helper source without claiming it - Settings owns the switch
    const result = await invoke("openInventoryFile", "helper");
    if (result) currentView.set("inventory");
  }

  function toggleOverlay(): void {
    send("toggle-overlay");
  }

  function testOverlay(): void {
    send("simulate-relic-trigger");
  }

  function testNotification(): void {
    void invoke("sendTestNotification");
  }
</script>

<nav
  id="sidebar"
  class="sidebar-shell flex min-h-0 w-[var(--sidebar-width)] shrink-0 flex-col justify-between gap-2 overflow-hidden border-r border-border bg-bg-base px-2.5 py-3.5"
  class:sidebar-collapsed={collapsed}
>
  <div
    bind:this={scrollerEl}
    class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden"
  >
    <button
      class="nav-btn nav-btn-collapse relative flex w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3.5 py-2.5 font-display text-base font-medium tracking-wide text-text-muted transition-colors duration-150 hover:bg-bg-hover hover:text-text-primary"
      title={$sidebarCollapsed ? $tr("nav.expandSidebar") : $tr("nav.collapseSidebar")}
      aria-label={$sidebarCollapsed ? $tr("nav.expandSidebar") : $tr("nav.collapseSidebar")}
      data-sidebar-collapse
      on:click={toggleSidebarCollapsed}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-5 w-5 shrink-0 transition-transform duration-150 {$sidebarCollapsed
          ? 'rotate-180'
          : ''}"
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
      <span>{$tr("nav.collapse")}</span>
    </button>
    {#snippet viewButton(item: NavItem, nested: boolean)}
      {@const isDraggingThis =
        dragActive && dragSubject?.kind === "view" && dragSubject.view === item.view}
      {@const isHeld = dragSubject?.kind === "view" && dragSubject.view === item.view}
      {@const isArmed = dropIntent?.zone === "center" && dropIntent.key === `view:${item.view}`}
      <button
        data-view={item.view}
        data-sidebar-row={`view:${item.view}`}
        data-sidebar-row-view={item.view}
        class="nav-btn relative flex w-full cursor-pointer items-center gap-3 rounded-md border-0 px-3.5 py-2.5 font-display text-base font-medium tracking-wide transition-colors duration-150 {nested
          ? 'pl-8'
          : ''} {$currentView === item.view
          ? "bg-[var(--view-accent-glow)] text-[var(--view-accent)] before:content-[''] before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-r before:bg-[var(--view-accent)] max-[800px]:before:hidden"
          : 'bg-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary'}"
        class:nav-btn-held={isHeld}
        class:nav-btn-dragging={isDraggingThis}
        class:nav-btn-armed={isArmed}
        aria-current={$currentView === item.view ? "page" : undefined}
        on:pointerdown={(e) => onRowPointerDown(item.view, e)}
        on:click={(e) => {
          // Draggable rows navigate on pointerup (onSidebarDragUp); fixed rows
          // never start a drag, so their mouse click has to navigate here.
          if (e.detail === 0 || FIXED_VIEWS.has(item.view)) currentView.set(item.view);
        }}
      >
        <span class="nav-hit" aria-hidden="true"></span>
        <img src={item.icon} alt="" class="h-6 w-6 shrink-0 object-contain brightness-[0.85]" />
        <span>{$sidebarLabels[item.view] ?? $tr(item.labelKey)}</span>
        {#if item.view === "messages" && $wfmChatUnread > 0}
          <span class="nav-unread" data-sidebar-unread
            >{$wfmChatUnread > 99 ? "99+" : $wfmChatUnread}</span
          >
        {/if}
      </button>
    {/snippet}

    {#each flatRows as row (row.key)}
      <div animate:flip={{ duration: 200 }}>
        {#if row.kind === "view"}
          {@render viewButton(row.item, row.groupId !== null)}
        {:else}
          {@const isDraggingThis =
            dragActive && dragSubject?.kind === "group" && dragSubject.id === row.id}
          {@const isHeld = dragSubject?.kind === "group" && dragSubject.id === row.id}
          {@const isArmed = dropIntent?.zone === "center" && dropIntent.key === row.key}
          <div
            data-sidebar-row={row.key}
            data-sidebar-row-group={row.id}
            class="nav-btn relative flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3.5 py-2.5 font-display text-base font-medium tracking-wide text-text-secondary transition-colors duration-150 hover:bg-bg-hover hover:text-text-primary"
            class:nav-btn-held={isHeld}
            class:nav-btn-dragging={isDraggingThis}
            class:nav-btn-armed={isArmed}
            role="button"
            tabindex="0"
            on:pointerdown={(e) => onGroupHeaderPointerDown(row.id, e)}
            on:click={(e) => {
              if (e.detail === 0) toggleGroupCollapsed(row.id);
            }}
            on:keydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleGroupCollapsed(row.id);
              }
            }}
          >
            <span class="nav-hit" aria-hidden="true"></span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="h-4 w-4 shrink-0 transition-transform duration-150 {row.collapsed
                ? ''
                : 'rotate-90'}"
            >
              <polyline points="9 6 15 12 9 18" />
            </svg>
            {#if editingGroupId === row.id}
              <input
                class="min-w-0 flex-1 rounded border border-accent-dim bg-bg-deep px-1.5 py-0.5 text-sm text-text-primary"
                value={row.name}
                maxlength={SIDEBAR_GROUP_NAME_MAX}
                use:focusOnMount
                on:pointerdown|stopPropagation
                on:click|stopPropagation
                on:blur={(e) => commitRename(row.id, e.currentTarget.value)}
                on:keydown={(e) => onRenameKeydown(row.id, e)}
              />
            {:else}
              <span
                class="min-w-0 flex-1 truncate"
                role="button"
                tabindex="-1"
                title={$tr("nav.renameGroupHint")}
                on:dblclick|stopPropagation={() => (editingGroupId = row.id)}
              >
                {row.name}
              </span>
              <span class="shrink-0 text-xs text-text-muted">({row.count})</span>
            {/if}
            <button
              type="button"
              class="shrink-0 rounded border-0 bg-transparent text-text-muted hover:text-text-primary"
              title={$tr("nav.ungroup")}
              aria-label={$tr("nav.ungroup")}
              on:click|stopPropagation={() => ungroupAll(row.id)}
            >
              &times;
            </button>
          </div>
        {/if}
      </div>
    {/each}

    {#if dropLine}
      <div
        class="nav-drop-line"
        data-sidebar-drop-line
        style="top: {dropLine.top}px; left: {dropLine.left}px; width: {dropLine.width}px"
      ></div>
    {/if}

    {#if dragActive && dragSubject}
      <div
        bind:this={ghostEl}
        class="nav-ghost"
        style="transform: translate3d({ghostInitialX + 14}px, {ghostInitialY + 14}px, 0)"
        in:scale={{ duration: 120, start: 0.92 }}
        out:fade={{ duration: 100 }}
      >
        {#if ghostIcon}
          <img src={ghostIcon} alt="" class="h-5 w-5 shrink-0 object-contain brightness-[0.85]" />
        {/if}
        <span class="truncate">{ghostLabel}</span>
      </div>
    {/if}
  </div>

  <div class="mt-auto flex shrink-0 flex-col gap-2">
    {#if showDevTools}
      <div class="mt-2 flex flex-col gap-0.5">
        <button
          class="nav-btn relative flex w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3.5 py-2.5 font-display text-base font-medium tracking-wide text-text-muted transition-colors duration-150 hover:bg-bg-hover hover:text-text-secondary"
          title={$tr("nav.previewSetupWizard")}
          on:click={() => {
            resetTourAutoStart();
            currentView.set("setup");
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            class="h-6 w-6 shrink-0"
          >
            <rect x="4" y="5" width="16" height="14" rx="2" />
            <path d="M8 9h8M8 13h5M16 13h1" />
          </svg>
          <span>{$tr("nav.setup")}</span>
        </button>
        <button
          class="nav-btn relative flex w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3.5 py-2.5 font-display text-base font-medium tracking-wide text-text-muted transition-colors duration-150 hover:bg-bg-hover hover:text-text-secondary"
          title={$tr("nav.testTitle")}
          on:click={testOverlay}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            class="h-6 w-6 shrink-0"
          >
            <path d="M9 3h6l1 6-3.5 2L16 21H8l3.5-10L8 9l1-6z" />
          </svg>
          <span>{$tr("nav.test")}</span>
        </button>
        <button
          class="nav-btn relative flex w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3.5 py-2.5 font-display text-base font-medium tracking-wide text-text-secondary transition-colors duration-150 hover:bg-bg-hover hover:text-text-primary"
          title={$tr("nav.overlayTitle")}
          on:click={toggleOverlay}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            class="h-6 w-6 shrink-0"
          >
            <polygon points="12,2 22,12 12,22 2,12" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          <span>{$tr("nav.overlay")}</span>
        </button>
        <button
          class="nav-btn relative flex w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3.5 py-2.5 font-display text-base font-medium tracking-wide text-text-secondary transition-colors duration-150 hover:bg-bg-hover hover:text-text-primary"
          title={$tr("nav.testNotificationTitle")}
          data-test-notification
          on:click={testNotification}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            class="h-6 w-6 shrink-0"
          >
            <path d="M18 16V11a6 6 0 10-12 0v5l-2 3h16l-2-3z" />
            <path d="M10 21h4" />
          </svg>
          <span>{$tr("nav.testNotification")}</span>
        </button>
        <button
          class="nav-btn relative flex w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3.5 py-2.5 font-display text-base font-medium tracking-wide text-text-secondary transition-colors duration-150 hover:bg-bg-hover hover:text-text-primary"
          on:click={loadInventoryFile}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            class="h-6 w-6 shrink-0"
          >
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>{$tr("nav.loadJson")}</span>
        </button>
      </div>
    {/if}
    <button
      type="button"
      data-customize-open
      class="nav-btn relative flex w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3.5 py-2.5 font-display text-base font-medium tracking-wide text-text-muted transition-colors duration-150 hover:bg-bg-hover hover:text-text-primary"
      title={$tr("presets.customizeButton")}
      aria-label={$tr("presets.customizeButton")}
      on:click={() => (customizeOpen = true)}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-6 w-6 shrink-0"
        aria-hidden="true"
      >
        <line x1="4" y1="6" x2="20" y2="6" />
        <circle cx="9" cy="6" r="2" fill="var(--bg-base)" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <circle cx="15" cy="12" r="2" fill="var(--bg-base)" />
        <line x1="4" y1="18" x2="20" y2="18" />
        <circle cx="11" cy="18" r="2" fill="var(--bg-base)" />
      </svg>
      <span>{$tr("presets.customizeButton")}</span>
    </button>
    <button
      type="button"
      data-feedback-open
      class="nav-btn relative flex w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent px-3.5 py-2.5 font-display text-base font-medium tracking-wide text-text-muted transition-colors duration-150 hover:bg-bg-hover hover:text-text-primary"
      title={$tr("feedback.title")}
      aria-label={$tr("feedback.title")}
      on:click={() => (feedbackOpen = true)}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-6 w-6 shrink-0"
        aria-hidden="true"
      >
        <path d="M21 15a3 3 0 01-3 3H8l-5 4V6a3 3 0 013-3h12a3 3 0 013 3z" />
        <path d="M8 10h8M8 14h5" />
      </svg>
      <span>{$tr("feedback.title")}</span>
    </button>
  </div>
</nav>

{#if customizeOpen}
  <PresetManagerModal onClose={() => (customizeOpen = false)} />
{/if}

{#if feedbackOpen}
  <FeedbackModal onClose={() => (feedbackOpen = false)} />
{/if}

<!-- A flex sibling rather than an overlay: the nav scrolls, so an absolutely
     positioned grip inside it would scroll away from the edge. -->
<div
  data-sidebar-grip
  class="sidebar-grip"
  class:sidebar-grip-active={resizing}
  role="slider"
  aria-orientation="horizontal"
  aria-label={$tr("nav.resizeSidebar")}
  aria-valuenow={effectiveWidth}
  aria-valuemin={SIDEBAR_RAIL_WIDTH}
  aria-valuemax={SIDEBAR_WIDTH_MAX}
  title={$tr("nav.resizeSidebarHint")}
  tabindex="0"
  on:pointerdown={startResize}
  on:pointermove={onResize}
  on:pointerup={endResize}
  on:pointercancel={endResize}
  on:lostpointercapture={endResize}
  on:dblclick={resetSidebarWidth}
  on:keydown={onGripKey}
></div>

<style>
  /* At rest it must read as nothing at all. A transparent grip shows the shell's
     --bg-deep, which paints a dark stripe beside the sidebar's gold border, so it
     carries the same --bg-base as the sidebar and the content on either side. */
  .sidebar-grip {
    flex: 0 0 auto;
    width: 5px;
    margin-left: 0;
    cursor: col-resize;
    background: var(--bg-base);
    border: 0;
    box-shadow: none;
    transition: background-color 0.12s ease;
  }
  .sidebar-grip:hover,
  .sidebar-grip:focus-visible,
  .sidebar-grip-active {
    background: var(--accent);
    outline: none;
  }
  /* Under 800px responsive.css pins the rail, so a drag here would do nothing. */
  @media (max-width: 800px) {
    .sidebar-grip {
      display: none;
    }
  }

  .sidebar-collapsed :global(.nav-btn span) {
    display: none;
  }
  .sidebar-collapsed :global(.nav-btn) {
    justify-content: center;
    padding-left: 0.5rem;
    padding-right: 0.5rem;
    gap: 0;
  }
  @media (max-width: 800px) {
    .nav-btn :global(span) {
      display: none;
    }
    .nav-btn {
      justify-content: center;
      padding-left: 0.625rem;
      padding-right: 0.625rem;
    }
  }

  /* Press feedback only - hover keeps the plain hover:bg-bg-hover lighten
     from before this feature existed. A patch a bit smaller than the row
     itself goes halfway dark - the same --bg-deep the Live Scraper's status
     panel uses - once the row is actually pressed. */
  .nav-unread {
    margin-left: auto;
    min-width: 1.25rem;
    border-radius: 999px;
    background: var(--accent);
    padding: 0 0.35rem;
    text-align: center;
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 1.25rem;
    color: var(--text-on-accent);
  }

  .nav-hit {
    position: absolute;
    inset: 6px;
    border-radius: 6px;
    background: transparent;
    pointer-events: none;
    transition: background-color 0.12s ease;
  }
  :global(.nav-btn:active) .nav-hit,
  :global(.nav-btn-held) .nav-hit {
    background: color-mix(in srgb, var(--bg-deep) 55%, transparent);
  }

  /* Held = the mouse button is down on this row (from pointerdown, before the
     drag threshold is even crossed, until release). Driven by a class rather
     than :active alone, because the pointerdown handler's preventDefault and
     the pointer leaving the row mid-drag both end :active early. The row
     presses in slightly and its patch gets an accent ring, so it is obvious
     which row is "in hand" even before the ghost appears. */
  :global(.nav-btn-held) {
    transform: scale(0.97);
    transition:
      transform 0.1s ease,
      opacity 0.12s ease;
  }
  :global(.nav-btn-held) .nav-hit {
    box-shadow: 0 0 0 1.5px var(--view-accent);
    transition:
      background-color 0.12s ease,
      box-shadow 0.12s ease;
  }

  /* The row in hand stays where it is until release and reads as "picked up";
     the cursor-following ghost is the visual focus meanwhile. */
  :global(.nav-btn-dragging) {
    opacity: 0.35;
    transition: opacity 0.12s ease;
  }

  /* Armed = releasing now groups the row in hand with this one. */
  :global(.nav-btn-armed) .nav-hit {
    inset: 3px;
    box-shadow: 0 0 0 2px var(--text-primary);
    transition:
      box-shadow 0.15s ease,
      inset 0.15s ease;
  }

  /* Where the row in hand will land. Fixed, so showing it never shifts a row. */
  .nav-drop-line {
    position: fixed;
    z-index: 999;
    height: 3px;
    margin-top: -1.5px;
    border-radius: 2px;
    background: var(--view-accent, var(--accent));
    box-shadow: 0 0 6px var(--view-accent, var(--accent));
    pointer-events: none;
  }

  /* Cursor-following clone of the dragged row. Fixed + translate3d only, so
     tracking the pointer never triggers layout - purely compositor work. */
  .nav-ghost {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    max-width: 220px;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    background: var(--bg-hover);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 500;
    box-shadow:
      var(--ui-panel-shadow),
      0 0 0 1px var(--border-strong);
    pointer-events: none;
    will-change: transform;
  }
</style>
