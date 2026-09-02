"use client";

/**
 * In-browser semantic embeddings via transformers.js (WebGPU when available,
 * WASM fallback otherwise). If the model cannot load at all — offline demo,
 * unsupported device — the app degrades gracefully to lexical-only search.
 */

import { emitProgress } from "./bus";

export type EmbeddingStatus = "idle" | "loading" | "ready" | "unavailable";

let status: EmbeddingStatus = "idle";
let extractorPromise: Promise<EmbedFn> | null = null;
const DIM = 384; // all-MiniLM-L6-v2

type EmbedFn = (texts: string[]) => Promise<number[][]>;

export function embeddingStatus(): EmbeddingStatus {
  return status;
}

function loadExtractor(): Promise<EmbedFn> {
  if (!extractorPromise) {
    status = "loading";
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;
      let pipe: Awaited<ReturnType<typeof pipeline>>;
      try {
        pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
          device: "webgpu",
          dtype: "q8",
        });
      } catch {
        pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
          dtype: "q8",
        });
      }
      status = "ready";
      return async (texts: string[]) => {
        if (texts.length === 0) return [];
        const out = await pipe(texts, { pooling: "mean", normalize: true });
        const rows: number[][] = [];
        for (let i = 0; i < texts.length; i++) {
          rows.push(Array.from(out.data as Float32Array).slice(i * DIM, (i + 1) * DIM));
        }
        return rows;
      };
    })().catch((err) => {
      status = "unavailable";
      extractorPromise = null;
      throw err;
    });
  }
  return extractorPromise;
}

export async function embedBatch(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const fn = await loadExtractor();
  const out: number[][] = [];
  const BATCH = 24;
  for (let i = 0; i < texts.length; i += BATCH) {
    const rows = await fn(texts.slice(i, i + BATCH));
    out.push(...rows);
    onProgress?.(Math.min(i + BATCH, texts.length), texts.length);
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are pre-normalized
}

/** Embed the query; returns null when semantic search is unavailable. */
export async function embedQuery(query: string): Promise<number[] | null> {
  try {
    const fn = await loadExtractor();
    const [row] = await fn([query]);
    return row;
  } catch {
    return null;
  }
}

export function reportEmbeddingPhase(phase: "embedding" | "ready", done = 0, total = 0, current?: string): void {
  emitProgress({ phase, done, total, current });
}
