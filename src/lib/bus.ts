"use client";

/**
 * A tiny DOM-event bus so the WebMCP tool layer (non-React) can talk to the
 * UI without coupling: activity pulses, citation rings, panel state.
 */

import type { ActivityEvent, CiteEvent, IndexProgress } from "./types";

export const EVENTS = {
  activity: "crate:activity",
  cite: "crate:cite",
  progress: "crate:progress",
  openDoc: "crate:open-doc",
  compare: "crate:compare",
  summarize: "crate:summarize",
  export: "crate:export",
} as const;

export function emit<T>(type: string, detail: T): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

export function on<T>(type: string, handler: (detail: T) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<T>).detail);
  window.addEventListener(type, listener);
  return () => window.removeEventListener(type, listener);
}

export function logActivity(ev: Omit<ActivityEvent, "id" | "at">): void {
  emit(EVENTS.activity, { ...ev, id: crypto.randomUUID(), at: Date.now() } satisfies ActivityEvent);
}

export function emitCite(ev: CiteEvent): void {
  emit(EVENTS.cite, ev);
}

export function emitProgress(p: IndexProgress): void {
  emit(EVENTS.progress, p);
}
