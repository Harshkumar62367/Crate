"use client";

/**
 * composeAskAnswer — the shared answering pipeline behind the human ask box
 * and the ask_my_files tool.
 *
 * 1. Hybrid search over the question.
 * 2. Ordinal questions ("first/second/last … of the 16 …") trigger a numbered
 *    list scan: find the document with the strongest numbered list (OCR often
 *    captures run logs as "1. step … 2. step …") and answer with the exact
 *    item the ordinal points at.
 * 3. Everything else falls back to cited passages, honestly framed.
 */

import { emitCite } from "./bus";
import { listDocs } from "./filestore";
import { searchDocuments } from "./search";
import type { CrateDoc, SearchHit } from "./types";

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
  seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

const MIN_LIST_LINES = 3;

export interface AskResult {
  mode: "list" | "passages" | "empty";
  answer: string;
  sources: Array<{ doc: string; snippet: string }>;
}

/** "1. DCR — client registered", "J 15. list-recent", "✓ 3. login" → numbered items. */
export function extractNumberedItems(text: string): Array<{ n: number; line: string }> {
  const items: Array<{ n: number; line: string }> = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/^[\s|>•✓√✔JOo\[\]()\-–—*]{0,4}\s*/, "").trim();
    const m = line.match(/^(\d{1,3})[.)]\s+(\S.*)$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < 1 || n > 99) continue;
    items.push({ n, line: m[0].trim() });
  }
  return items;
}

function ordinalTarget(question: string): { word: string; n: number | "max" } | null {
  const q = question.toLowerCase();
  for (const [word, n] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(q)) return { word, n };
  }
  if (/\blast\b/.test(q)) return { word: "last", n: "max" };
  return null;
}

export async function composeAskAnswer(question: string): Promise<AskResult> {
  const trimmed = question.trim();
  if (!trimmed) {
    return { mode: "empty", answer: "Type a question first.", sources: [] };
  }

  const hits = await searchDocuments(trimmed, 6);
  const docs = await listDocs();

  // Ordinal questions: look for a numbered list strong enough to answer from.
  // Runs BEFORE the empty check — a "first … of the 16" question can share no
  // vocabulary with the files (OCR of a numbered run log) and still be
  // answerable from a detected list.
  const target = ordinalTarget(trimmed);
  if (target) {
    let best: { doc: CrateDoc; items: Array<{ n: number; line: string }>; score: number } | null = null;
    for (const doc of docs) {
      const items = extractNumberedItems(doc.text);
      if (items.length < MIN_LIST_LINES) continue;
      const bestHit = hits.find((h) => h.docId === doc.id);
      const score = items.length + (bestHit ? bestHit.score : 0);
      if (!best || score > best.score) best = { doc, items, score };
    }
    if (best) {
      const nums = best.items.map((i) => i.n);
      const max = Math.max(...nums);
      const want = target.n === "max" ? max : target.n;
      const item = best.items.find((i) => i.n === want) ?? best.items.find((i) => i.n === want - 1);
      if (item) {
        emitCite({
          docId: best.doc.id,
          docName: best.doc.name,
          quote: item.line,
          note: `Answering: ${trimmed}`,
        });
        return {
          mode: "list",
          answer:
            `${item.line}\n\n` +
            `That is item ${item.n} of at least ${max} numbered steps found in “${best.doc.name}” ` +
            `(the ${target.word} one you asked for).`,
          sources: [{ doc: best.doc.name, snippet: item.line }],
        };
      }
    }
  }

  if (hits.length === 0) {
    const textless = docs.filter((d) => !d.text.trim()).length;
    return {
      mode: "empty",
      answer:
        docs.length === 0
          ? "Your Crate is empty — drop a folder first."
          : textless === docs.length
            ? `None of your ${docs.length} files contain searchable text (they may be images whose text OCR could not read, or binary files). Try different wording, or drop in text-based files.`
            : "Nothing in your Crate matches that. Try different wording, or drop in more files.",
      sources: [],
    };
  }

  // Fallback: ranked passages, grouped per document, top source cited.
  const byDoc = new Map<string, SearchHit[]>();
  for (const h of hits) {
    const list = byDoc.get(h.docId) ?? [];
    list.push(h);
    byDoc.set(h.docId, list);
  }
  const sources: Array<{ doc: string; snippet: string }> = [];
  const topDocId = hits[0].docId;
  let i = 0;
  for (const [docId, docHits] of byDoc) {
    const docName = docHits[0].docName;
    if (docId === topDocId) {
      emitCite({ docId, docName, quote: docHits[0].snippet, note: `Answering: ${trimmed}` });
    }
    for (const h of docHits.slice(0, 2)) {
      i++;
      sources.push({ doc: docName, snippet: h.snippet });
    }
  }
  return {
    mode: "passages",
    answer: sources
      .map((s, idx) => `${idx + 1}. [${s.doc}] ${s.snippet}`)
      .join("\n\n"),
    sources,
  };
}
