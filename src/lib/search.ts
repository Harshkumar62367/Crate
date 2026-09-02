"use client";

/**
 * Hybrid search: BM25 over chunk text + cosine similarity over in-browser
 * embeddings, combined into a single 0..1 score. Works lexical-only when the
 * embedding model is unavailable.
 */

import { cosine, embedQuery } from "./embeddings";
import { listChunks, listDocs } from "./filestore";
import type { CrateChunk, SearchHit } from "./types";

const STOP = new Set(
  "a an and are as at be but by for from has have if in into is it its of on or that the their they this to was were will with what which who whom how why when where".split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

interface Bm25Index {
  chunks: CrateChunk[];
  tf: Map<string, number>[];
  docLen: number[];
  avgLen: number;
  df: Map<string, number>;
}

let cached: Bm25Index | null = null;
let cachedAt = 0;

async function bm25Index(): Promise<Bm25Index> {
  if (cached && Date.now() - cachedAt < 30_000) return cached;
  const chunks = await listChunks();
  const tf: Map<string, number>[] = [];
  const docLen: number[] = [];
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const c of chunks) {
    const terms = tokenize(c.text);
    docLen.push(terms.length);
    totalLen += terms.length;
    const counts = new Map<string, number>();
    for (const t of terms) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    tf.push(counts);
  }
  cached = {
    chunks,
    tf,
    docLen,
    avgLen: chunks.length ? totalLen / chunks.length : 0,
    df,
  };
  cachedAt = Date.now();
  return cached;
}

export function invalidateSearchCache(): void {
  cached = null;
}

const K1 = 1.4;
const B = 0.72;

function bm25Scores(index: Bm25Index, terms: string[]): number[] {
  const N = index.chunks.length;
  const scores = new Array(N).fill(0);
  for (const term of terms) {
    const n = index.df.get(term) ?? 0;
    if (n === 0) continue;
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    for (let i = 0; i < N; i++) {
      const f = index.tf[i].get(term) ?? 0;
      if (f === 0) continue;
      const norm = (f * (K1 + 1)) / (f + K1 * (1 - B + (B * index.docLen[i]) / (index.avgLen || 1)));
      scores[i] += idf * norm;
    }
  }
  return scores;
}

function snippetFor(chunk: CrateChunk, terms: string[]): string {
  const lower = chunk.text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) at = 0;
  const from = Math.max(0, at - 80);
  const slice = chunk.text.slice(from, from + 240).trim();
  return (from > 0 ? "…" : "") + slice + (from + 240 < chunk.text.length ? "…" : "");
}

export async function searchDocuments(query: string, limit = 10): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const index = await bm25Index();
  if (index.chunks.length === 0) return [];
  const terms = tokenize(trimmed);

  const lex = bm25Scores(index, terms);
  const maxLex = Math.max(...lex, 0.0001);

  const qVec = await embedQuery(trimmed);
  // MiniLM cosine below ~0.3 means "no real relation". Without this floor,
  // gibberish and punctuation queries surface noise hits at 0.1-ish scores.
  const SEMANTIC_FLOOR = 0.3;

  const hits: SearchHit[] = index.chunks.map((chunk, i) => {
    const lexScore = lex[i] / maxLex;
    let semScore = 0;
    if (qVec && chunk.embedding) {
      const sem = Math.max(0, cosine(qVec, chunk.embedding));
      semScore = sem >= SEMANTIC_FLOOR ? sem : 0;
    }
    const score = qVec ? 0.55 * lexScore + 0.45 * semScore : lexScore;
    return {
      docId: chunk.docId,
      docName: chunk.docName,
      chunkId: chunk.id,
      snippet: snippetFor(chunk, terms),
      score: Math.round(score * 1000) / 1000,
      start: chunk.start,
      end: chunk.end,
    };
  });

  return hits
    .filter((h) => h.score > 0.02)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Top sentences of a document, ranked against a query (or by position if no query). */
export function summarizeExtractively(text: string, query?: string, bullets = 3): string[] {
  const clean = text.replace(/\[Page \d+\]/g, "").replace(/\s+/g, " ");
  const sentences = clean.split(/(?<=[.!?])\s+/).filter((s) => s.length > 15 && s.length < 400);
  if (sentences.length <= bullets) return sentences;
  const terms = query ? tokenize(query) : [];
  const scored = sentences.map((s, i) => {
    const st = tokenize(s);
    let score = 0;
    for (const t of st) {
      if (terms.includes(t)) score += 3;
      score += 0.02;
    }
    score *= 1 - i / (sentences.length * 2); // mild preference for earlier context
    return { s, score, i };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, bullets)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
}

/** Distinctive terms of a document vs the whole corpus — used for compare_documents. */
export async function topTerms(docId: string, k = 8): Promise<string[]> {
  const index = await bm25Index();
  const docs = await listDocs();
  const N = Math.max(1, docs.length);
  const first = index.chunks.findIndex((c) => c.docId === docId);
  if (first === -1) return [];
  const counts = new Map<string, number>();
  for (let i = 0; i < index.chunks.length; i++) {
    if (index.chunks[i].docId !== docId) continue;
    for (const [t, f] of index.tf[i]) counts.set(t, (counts.get(t) ?? 0) + f);
  }
  return [...counts.entries()]
    .map(([t, f]) => {
      const df = index.df.get(t) ?? 1;
      return { t, score: (f / (df + 1)) * Math.log(1 + N) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.t);
}
