"use client";

/**
 * FileStore — everything the user drops lives in IndexedDB, in their browser.
 * Nothing is ever uploaded; there is no server to upload to.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CrateChunk, CrateDoc } from "./types";

interface CrateDB extends DBSchema {
  docs: {
    key: string;
    value: CrateDoc;
    indexes: { by_name: string };
  };
  chunks: {
    key: string;
    value: CrateChunk;
    indexes: { by_doc: string };
  };
}

let dbp: Promise<IDBPDatabase<CrateDB>> | null = null;

function db(): Promise<IDBPDatabase<CrateDB>> {
  if (!dbp) {
    dbp = openDB<CrateDB>("crate", 1, {
      upgrade(d) {
        const docs = d.createObjectStore("docs", { keyPath: "id" });
        docs.createIndex("by_name", "name");
        const chunks = d.createObjectStore("chunks", { keyPath: "id" });
        chunks.createIndex("by_doc", "docId");
      },
    });
  }
  return dbp;
}

export async function putDoc(doc: CrateDoc, chunks: CrateChunk[]): Promise<void> {
  const d = await db();
  const tx = d.transaction(["docs", "chunks"], "readwrite");
  await Promise.all([
    tx.objectStore("docs").put(doc),
    (async () => {
      const store = tx.objectStore("chunks");
      const old = await store.index("by_doc").getAllKeys(doc.id);
      for (const key of old) await store.delete(key);
      for (const c of chunks) await store.put(c);
    })(),
    tx.done,
  ]);
}

export async function updateDoc(doc: CrateDoc): Promise<void> {
  const d = await db();
  await d.put("docs", doc);
}

export async function listDocs(): Promise<CrateDoc[]> {
  const d = await db();
  return d.getAll("docs");
}

export async function getDoc(id: string): Promise<CrateDoc | undefined> {
  const d = await db();
  return d.get("docs", id);
}

export async function findDocByName(name: string): Promise<CrateDoc | undefined> {
  const d = await db();
  const docs = await d.getAllFromIndex("docs", "by_name", name);
  return docs[0];
}

/** Resolve a doc by id, name, or case-insensitive name suffix ("q3.pdf"). */
export async function resolveDoc(ref: string): Promise<CrateDoc | undefined> {
  const trimmed = ref.trim();
  if (!trimmed) return undefined;
  const byId = await getDoc(trimmed);
  if (byId) return byId;
  const docs = await listDocs();
  const lower = trimmed.toLowerCase();
  return (
    docs.find((d) => d.name.toLowerCase() === lower) ??
    docs.find((d) => d.path.toLowerCase() === lower) ??
    docs.find((d) => d.name.toLowerCase().endsWith(lower)) ??
    docs.find((d) => lower.length > 3 && d.name.toLowerCase().includes(lower))
  );
}

export async function listChunks(): Promise<CrateChunk[]> {
  const d = await db();
  return d.getAll("chunks");
}

export async function updateChunk(chunk: CrateChunk): Promise<void> {
  const d = await db();
  await d.put("chunks", chunk);
}

export async function deleteDoc(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["docs", "chunks"], "readwrite");
  await Promise.all([
    tx.objectStore("docs").delete(id),
    (async () => {
      const store = tx.objectStore("chunks");
      const keys = await store.index("by_doc").getAllKeys(id);
      for (const k of keys) await store.delete(k);
    })(),
    tx.done,
  ]);
}

export async function clearAll(): Promise<void> {
  const d = await db();
  const tx = d.transaction(["docs", "chunks"], "readwrite");
  await Promise.all([
    tx.objectStore("docs").clear(),
    tx.objectStore("chunks").clear(),
    tx.done,
  ]);
}

export async function docCount(): Promise<number> {
  const d = await db();
  return d.count("docs");
}

/** Split extracted text into overlapping ~900-char chunks on paragraph bounds. */
export function chunkText(text: string, target = 900, overlap = 120): Array<Pick<CrateChunk, "text" | "start" | "end">> {
  if (!text.trim()) return [];
  const chunks: Array<Pick<CrateChunk, "text" | "start" | "end">> = [];
  const paras: Array<{ start: number; end: number }> = [];
  let idx = 0;
  for (const para of text.split(/\n{2,}/)) {
    if (para.trim()) paras.push({ start: idx, end: idx + para.length });
    idx += para.length + 2;
  }
  let cur = paras[0]?.start ?? 0;
  while (cur < text.length) {
    let end = cur + target;
    // Prefer breaking at a paragraph boundary near the target.
    const boundary = paras.find((p) => p.start >= cur + target * 0.5 && p.start <= end);
    if (boundary) end = boundary.start;
    const slice = text.slice(cur, Math.min(end, text.length));
    if (slice.trim()) chunks.push({ text: slice, start: cur, end: cur + slice.length });
    if (end >= text.length) break;
    cur = Math.max(cur + 1, end - overlap);
  }
  return chunks;
}
