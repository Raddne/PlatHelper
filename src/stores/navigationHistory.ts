// Browser-style back/forward history over the sidebar's currentView store, so
// mouse side buttons (and Alt+Left/Right) work the way they do in a browser.
// There is no router in this app (see src/stores/app.ts's currentView) - every
// view switch is a plain `currentView.set(...)` call from many different
// places (Sidebar.svelte, App.svelte, etc.). Rather than touching every call
// site, this subscribes to currentView itself and tells apart a "real" user
// navigation from one this module caused itself via goBack/goForward, so it
// never records its own replays as new history entries.

import { get, writable } from "svelte/store";
import { currentView } from "./app.js";
import type { ViewName } from "../types/views.js";

const MAX_ENTRIES = 100;

let backStack: ViewName[] = [];
let forwardStack: ViewName[] = [];
let suppressNextPush = false;
let lastView: ViewName = get(currentView);

function pushBounded(stack: ViewName[], value: ViewName): void {
  stack.push(value);
  if (stack.length > MAX_ENTRIES) stack.shift();
}

const canGoBackStore = writable(false);
const canGoForwardStore = writable(false);

function publish(): void {
  canGoBackStore.set(backStack.length > 0);
  canGoForwardStore.set(forwardStack.length > 0);
}

currentView.subscribe((view) => {
  if (view === lastView) return;
  if (suppressNextPush) {
    suppressNextPush = false;
    lastView = view;
    return;
  }
  // A fresh, user- or app-initiated navigation invalidates whatever "forward"
  // history existed - exactly like a browser dropping forward history the
  // moment you click a new link instead of pressing the forward button.
  pushBounded(backStack, lastView);
  forwardStack = [];
  lastView = view;
  publish();
});

export function goBack(): void {
  const previous = backStack.pop();
  if (previous === undefined) return;
  pushBounded(forwardStack, lastView);
  suppressNextPush = true;
  currentView.set(previous);
  publish();
}

export function goForward(): void {
  const next = forwardStack.pop();
  if (next === undefined) return;
  pushBounded(backStack, lastView);
  suppressNextPush = true;
  currentView.set(next);
  publish();
}
