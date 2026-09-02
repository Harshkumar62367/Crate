"use client";

/**
 * Folder ingestion: walks a dropped directory (or file list), extracts text,
 * chunks it, embeds chunks — all client-side — and reports progress to the UI.
 */

import { emitProgress, EVENTS, emit } from "./bus";
import { extractFile } from "./extract";
import { chunkText, deleteDoc, listDocs, putDoc } from "./filestore";
import { embedBatch, embeddingStatus } from "./embeddings";
import { invalidateSearchCache } from "./search";
import { kindForName, MAX_FILE_BYTES, type CrateChunk, type CrateDoc } from "./types";

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".venv", "__pycache__", "vendor"]);

interface Entry {
  file: File;
  path: string;
}

/** Walk dropped items (which may be directories) into a flat file list. */
async function collectEntries(items: DataTransferItemList): Promise<Entry[]> {
  const entries: Entry[] = [];
  const roots: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }
  if (roots.length === 0) return []; // caller falls back to plain File list

  const walk = async (dir: FileSystemDirectoryEntry, prefix: string): Promise<void> => {
    const reader = dir.createReader();
    const readAll = async (): Promise<FileSystemEntry[]> => {
      const all: FileSystemEntry[] = [];
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) =>
          reader.readEntries(res, rej),
        );
        if (batch.length === 0) return all;
        all.push(...batch);
      }
    };
    for (const e of await readAll()) {
      if (e.isFile) {
        const file = await new Promise<File>((res, rej) =>
          (e as FileSystemFileEntry).file(res, rej),
        );
        entries.push({ file, path: prefix + e.name });
      } else if (e.isDirectory && !SKIP_DIRS.has(e.name)) {
        await walk(e as FileSystemDirectoryEntry, `${prefix}${e.name}/`);
      }
    }
  };

  for (const root of roots) {
    if (root.isFile) {
      const file = await new Promise<File>((res, rej) =>
        (root as FileSystemFileEntry).file(res, rej),
      );
      entries.push({ file, path: root.name });
    } else if (root.isDirectory && !SKIP_DIRS.has(root.name)) {
      await walk(root as FileSystemDirectoryEntry, `${root.name}/`);
    }
  }
  return entries;
}

export async function ingestDrop(
  dt: DataTransfer | null,
  plainFiles: FileList | File[],
): Promise<{ added: number; skipped: number }> {
  let entries: Entry[] = dt ? await collectEntries(dt.items) : [];
  if (entries.length === 0 && dt?.files?.length) {
    entries = Array.from(dt.files).map((f) => ({ file: f, path: f.name }));
  }
  if (entries.length === 0) {
    entries = Array.from(plainFiles).map((f) => ({ file: f, path: f.name }));
  }

  const existing = new Set((await listDocs()).map((d) => d.path));
  const accepted: Entry[] = [];
  let skipped = 0;
  for (const e of entries) {
    if (existing.has(e.path) || e.file.size > MAX_FILE_BYTES || e.file.size === 0) {
      skipped++;
      continue;
    }
    accepted.push(e);
  }

  emitProgress({ phase: "extracting", total: accepted.length, done: 0 });

  const docs: CrateDoc[] = [];
  let done = 0;
  for (const { file, path } of accepted) {
    const kind = kindForName(file.name, file.type);
    // Announce the file BEFORE its (possibly slow) extraction so the UI shows
    // what OCR is working on instead of a stale label.
    emitProgress({
      phase: "extracting",
      total: accepted.length,
      done,
      current: kind === "image" ? `${path} (reading text via OCR…)` : path,
    });
    let text = "";
    let pages: number | undefined;
    try {
      if (kind === "image") {
        // OCR runs locally (WASM) so image contents become searchable.
        const ocr = await import("./ocr");
        text = await ocr.ocrImage(file);
      } else {
        const out = await extractFile(file, kind);
        text = out.text;
        pages = out.pages;
      }
    } catch (err) {
      console.warn(`Crate: extraction failed for ${path}`, err);
    }
    const doc: CrateDoc = {
      id: crypto.randomUUID(),
      name: file.name,
      path,
      kind,
      mime: file.type,
      size: file.size,
      text,
      pages,
      addedAt: Date.now(),
    };
    const chunks = chunkText(text).map((c, i) => ({
      id: `${doc.id}:${i}`,
      docId: doc.id,
      docName: doc.name,
      index: i,
      ...c,
    }));
    await putDoc(doc, chunks);
    docs.push(doc);
    done++;
    emitProgress({ phase: "extracting", total: accepted.length, done, current: path });
  }

  if (docs.length > 0) invalidateSearchCache();

  // Embed chunks for semantic search (best effort — lexical search still works).
  if (docs.some((d) => d.text.trim())) {
    try {
      const allChunks: CrateChunk[] = [];
      for (const doc of docs) {
        const chunks = chunkText(doc.text).map((c, i) => ({
          id: `${doc.id}:${i}`,
          docId: doc.id,
          docName: doc.name,
          index: i,
          ...c,
        }));
        allChunks.push(...chunks);
      }
      if (allChunks.length > 0) {
        emitProgress({ phase: "embedding", total: allChunks.length, done: 0 });
        const vectors = await embedBatch(
          allChunks.map((c) => c.text),
          (d, t) => emitProgress({ phase: "embedding", total: t, done: d }),
        );
        allChunks.forEach((c, i) => {
          c.embedding = vectors[i];
        });
        // Re-put docs' chunks with embeddings.
        for (const doc of docs) {
          const chunks = allChunks.filter((c) => c.docId === doc.id);
          if (chunks.length) await putDoc(doc, chunks);
        }
      }
    } catch (err) {
      console.warn("Crate: embedding model unavailable, using lexical search only", err);
    }
  }

  emitProgress({ phase: "ready", total: docs.length, done: docs.length });
  emit(EVENTS.progress, {
    phase: "ready",
    total: docs.length,
    done: docs.length,
    embedStatus: embeddingStatus(),
  });
  return { added: docs.length, skipped };
}

export async function removeDoc(id: string): Promise<void> {
  await deleteDoc(id);
  invalidateSearchCache();
}
