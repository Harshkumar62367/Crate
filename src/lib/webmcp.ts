"use client";

/**
 * The WebMCP tool layer — the load-bearing part of Crate.
 *
 * Eight imperative tools are registered on `document.modelContext` so any
 * agent that visits the page (ChatGPT's in-app browser, Chrome with the WebMCP
 * flag, Nekuda Workbench, Stagehand…) can call them against the user's actual
 * local files. Registration is state-aware: with an empty Crate only
 * `get_crate_status` exists; the full toolset appears once files are indexed
 * and `toolchange` tells the agent to re-read the tool list.
 *
 * Every handler honours the agent's AbortSignal, logs a visible activity
 * event, and uses annotations per the spec's security guidance (readOnlyHint
 * for reads; a `confirm` schema field on mutating tools).
 */

import { emit, EVENTS, logActivity, emitCite } from "./bus";
import { docCount, listDocs, resolveDoc, updateDoc } from "./filestore";
import { searchDocuments, summarizeExtractively, topTerms } from "./search";
import { embeddingStatus } from "./embeddings";
import type { CrateDoc, SearchHit } from "./types";

function ok(tool: string, input: Record<string, unknown>): void {
  logActivity({ tool, input, status: "running" });
}

function fail(tool: string, input: Record<string, unknown>, err: unknown): string {
  logActivity({ tool, input, status: "error", detail: String(err) });
  return JSON.stringify({ error: String(err) });
}

function hitsPayload(hits: SearchHit[]) {
  return hits.map((h) => ({
    doc: h.docName,
    doc_id: h.docId,
    snippet: h.snippet,
    score: h.score,
    location: { start: h.start, end: h.end },
  }));
}

/* ------------------------------------------------------------------ */
/* Tool definitions                                                    */
/* ------------------------------------------------------------------ */

export function makeSearchDocuments(): ModelContextTool {
  return {
    name: "search_documents",
    title: "Search the user's files",
    description:
      "Hybrid full-text + semantic search across every file the user dropped into this Crate. " +
      "Returns up to 10 results with doc name, doc_id, a ~240-char snippet, and a 0-1 score. " +
      "ALWAYS call this first before open_document or cite_source. " +
      "Returns an empty array if nothing matches — do not invent files.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language or keyword search, 1-10 words" },
        limit: { type: "number", description: "Max results, 1-25 (default 10)" },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true },
    execute: async (input, { signal }) => {
      const tool = "search_documents";
      try {
        ok(tool, input);
        const query = String(input.query ?? "");
        const limit = Math.min(25, Math.max(1, Number(input.limit) || 10));
        const hits = await searchDocuments(query, limit);
        signal.throwIfAborted();
        logActivity({ tool, input, status: "ok", detail: `${hits.length} hits` });
        return JSON.stringify({ query, results: hitsPayload(hits) });
      } catch (err) {
        return fail(tool, input, err);
      }
    },
  };
}

export function makeOpenDocument(): ModelContextTool {
  return {
    name: "open_document",
    title: "Open a document from the Crate",
    description:
      "Return the text of one indexed document by doc_id or file name (a unique suffix works). " +
      "For PDFs, pass page to get just that page (pages are 1-based and marked [Page N]); " +
      "otherwise the first ~6000 characters are returned. The document also opens in the page " +
      "viewer so the user can follow along.",
    inputSchema: {
      type: "object",
      properties: {
        doc: { type: "string", description: "doc_id or file name from search_documents results" },
        page: { type: "number", description: "For PDFs: 1-based page number" },
      },
      required: ["doc"],
    },
    annotations: { readOnlyHint: true },
    execute: async (input, { signal }) => {
      const tool = "open_document";
      try {
        ok(tool, input);
        const doc = await resolveDoc(String(input.doc ?? ""));
        if (!doc) throw new Error(`No document matches "${input.doc}"`);
        signal.throwIfAborted();
        emit(EVENTS.openDoc, doc.id);
        let text = doc.text;
        let note = "";
        if (doc.kind === "pdf" && typeof input.page === "number") {
          const marker = `[Page ${Math.trunc(input.page)}]`;
          const at = text.indexOf(marker);
          const next = text.indexOf("\n[Page ", at + 1);
          text = at === -1 ? "" : text.slice(at, next === -1 ? undefined : next);
          note = ` (page ${input.page} of ${doc.pages})`;
        } else if (text.length > 6000) {
          text = text.slice(0, 6000);
          note = ` (first 6000 of ${doc.text.length} chars)`;
        }
        logActivity({ tool, input, status: "ok", detail: doc.name });
        return JSON.stringify({
          doc: doc.name,
          doc_id: doc.id,
          kind: doc.kind,
          pages: doc.pages,
          text: text || "(no extractable text — likely an image or binary file)",
          note: note.trim(),
        });
      } catch (err) {
        return fail(tool, input, err);
      }
    },
  };
}

export function makeCiteSource(): ModelContextTool {
  return {
    name: "cite_source",
    title: "Highlight a citation for the user",
    description:
      "Scroll to and ring-highlight a quoted span in the document viewer so the user sees exactly " +
      "where an answer came from. Call AFTER open_document (or a search hit) with an exact, " +
      "short quote (under 25 words) copied verbatim from the document text.",
    inputSchema: {
      type: "object",
      properties: {
        doc: { type: "string", description: "doc_id or file name the quote comes from" },
        quote: { type: "string", description: "Exact span copied verbatim from the document text" },
        note: { type: "string", description: "Optional one-line reason for the citation" },
      },
      required: ["doc", "quote"],
    },
    annotations: { readOnlyHint: true },
    execute: async (input, { signal }) => {
      const tool = "cite_source";
      try {
        ok(tool, input);
        const doc = await resolveDoc(String(input.doc ?? ""));
        if (!doc) throw new Error(`No document matches "${input.doc}"`);
        const quote = String(input.quote ?? "").trim();
        signal.throwIfAborted();
        emitCite({ docId: doc.id, docName: doc.name, quote, note: input.note ? String(input.note) : undefined });
        logActivity({ tool, input, status: "ok", detail: doc.name });
        return JSON.stringify({ cited: doc.name, quote });
      } catch (err) {
        return fail(tool, input, err);
      }
    },
  };
}

export function makeSummarizeDoc(): ModelContextTool {
  return {
    name: "summarize_doc",
    title: "Summarize a document",
    description:
      "Write a 3-bullet extractive summary of one document. This overwrites the document's stored " +
      "summary, so you MUST ask the user first and pass confirm=true only after they agree. " +
      "The summary appears in the page's side panel.",
    inputSchema: {
      type: "object",
      properties: {
        doc: { type: "string", description: "doc_id or file name" },
        focus: { type: "string", description: "Optional topic to bias the summary toward" },
        confirm: { type: "boolean", description: "Set true only after the user approves writing the summary" },
      },
      required: ["doc", "confirm"],
    },
    annotations: { untrustedContentHint: true },
    execute: async (input, { signal }) => {
      const tool = "summarize_doc";
      try {
        ok(tool, input);
        if (input.confirm !== true) {
          throw new Error("User has not confirmed. Ask them, then call again with confirm=true.");
        }
        const doc = await resolveDoc(String(input.doc ?? ""));
        if (!doc) throw new Error(`No document matches "${input.doc}"`);
        signal.throwIfAborted();
        const bullets = summarizeExtractively(doc.text, input.focus ? String(input.focus) : undefined, 3);
        const summary = bullets.map((b) => `• ${b}`).join("\n");
        await updateDoc({ ...doc, summary });
        emit(EVENTS.summarize, { docId: doc.id, summary });
        logActivity({ tool, input, status: "ok", detail: doc.name });
        return JSON.stringify({ doc: doc.name, summary: bullets });
      } catch (err) {
        return fail(tool, input, err);
      }
    },
  };
}

export function makeCompareDocuments(): ModelContextTool {
  return {
    name: "compare_documents",
    title: "Compare 2-5 documents",
    description:
      "Build a side-by-side comparison of 2-5 documents on a question. Returns per-document " +
      "metadata, the most relevant snippets for the question, and each document's distinctive " +
      "terms. The comparison table also renders on the page. Call search_documents first if you " +
      "need full text of any document.",
    inputSchema: {
      type: "object",
      properties: {
        docs: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 5,
          description: "doc_ids or file names to compare",
        },
        question: { type: "string", description: "What to compare them on" },
      },
      required: ["docs", "question"],
    },
    annotations: { readOnlyHint: true },
    execute: async (input, { signal }) => {
      const tool = "compare_documents";
      try {
        ok(tool, input);
        const refs = Array.isArray(input.docs) ? input.docs.map(String) : [];
        if (refs.length < 2 || refs.length > 5) throw new Error("Pass 2-5 document references.");
        const question = String(input.question ?? "");
        const rows = [];
        for (const ref of refs) {
          const doc = await resolveDoc(ref);
          if (!doc) throw new Error(`No document matches "${ref}"`);
          const [hit] = await searchDocuments(`${question} ${doc.name}`.trim(), 1);
          const snippet = hit?.snippet ?? summarizeExtractively(doc.text, question, 1)[0] ?? "";
          rows.push({
            doc: doc.name,
            doc_id: doc.id,
            kind: doc.kind,
            size: doc.size,
            pages: doc.pages ?? undefined,
            best_matching_snippet: snippet,
            distinctive_terms: await topTerms(doc.id, 6),
          });
        }
        signal.throwIfAborted();
        emit(EVENTS.compare, { question, rows });
        logActivity({ tool, input, status: "ok", detail: rows.map((r) => r.doc).join(" vs ") });
        return JSON.stringify({ question, comparison: rows });
      } catch (err) {
        return fail(tool, input, err);
      }
    },
  };
}

export function makeExtractTable(): ModelContextTool {
  return {
    name: "extract_table",
    title: "Extract tabular data as CSV",
    description:
      "Extract tabular data from a document and return it as a CSV string. Works directly on CSV " +
      "files and Markdown tables; for PDFs and text it returns lines that look like rows of " +
      "columns. Pass the result to export_table to save it as a file.",
    inputSchema: {
      type: "object",
      properties: {
        doc: { type: "string", description: "doc_id or file name" },
      },
      required: ["doc"],
    },
    annotations: { readOnlyHint: true },
    execute: async (input, { signal }) => {
      const tool = "extract_table";
      try {
        ok(tool, input);
        const doc = await resolveDoc(String(input.doc ?? ""));
        if (!doc) throw new Error(`No document matches "${input.doc}"`);
        signal.throwIfAborted();
        const csv = tableFromDoc(doc);
        logActivity({ tool, input, status: "ok", detail: doc.name });
        return JSON.stringify({ doc: doc.name, csv });
      } catch (err) {
        return fail(tool, input, err);
      }
    },
  };
}

/** Exported for tests: turns a document's text into a CSV string. */
export function tableFromDoc(doc: CrateDoc): string {
  if (doc.kind === "csv") return doc.text.trim();
  const lines = doc.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const md = lines.filter((l) => l.includes("|") && l.split("|").length >= 3);
  if (md.length >= 2) {
    const rows = md
      .filter((l) => !/^\|?\s*-{2,}/.test(l)) // drop markdown separator rows
      .map((l) =>
        l
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => `"${c.trim().replace(/"/g, '""')}"`)
          .join(","),
      );
    return rows.join("\n");
  }
  const tabular = lines.filter((l) => (l.match(/\t| {2,}|;/g) ?? []).length >= 2);
  if (tabular.length >= 2) {
    return tabular
      .map((l) =>
        l
          .split(/\t| {2,}|;/)
          .map((c) => `"${c.trim().replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
  }
  return "";
}

export function makeExportTable(): ModelContextTool {
  return {
    name: "export_table",
    title: "Download a CSV/JSON file",
    description:
      "Trigger a file download in the user's browser with the given content. Use after " +
      "extract_table to save extracted data, or to hand the user any generated CSV/JSON. " +
      "This saves a file to the user's disk, so you MUST ask the user first and pass " +
      "confirm=true only after they agree.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Full file content to download" },
        filename: { type: "string", description: "Target file name, e.g. comparison.csv" },
        confirm: { type: "boolean", description: "Set true only after the user approves the download" },
      },
      required: ["content", "filename", "confirm"],
    },
    annotations: { untrustedContentHint: true },
    execute: async (input, { signal }) => {
      const tool = "export_table";
      try {
        ok(tool, input);
        if (input.confirm !== true) {
          throw new Error("User has not confirmed. Ask them, then call again with confirm=true.");
        }
        const content = String(input.content ?? "");
        const filename = String(input.filename ?? "crate-export.csv").replace(/[^\w.-]/g, "_");
        signal.throwIfAborted();
        const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        emit(EVENTS.export, { filename, bytes: content.length });
        logActivity({ tool, input, status: "ok", detail: filename });
        return JSON.stringify({ downloaded: filename, bytes: content.length });
      } catch (err) {
        return fail(tool, input, err);
      }
    },
  };
}

export function makeAskMyFiles(): ModelContextTool {
  return {
    name: "ask_my_files",
    title: "Ask a question across all files",
    description:
      "One-shot question answering over the whole Crate: searches, and either answers ordinal " +
      "questions directly from numbered lists found in the files (e.g. 'the first of the 16 tests'), " +
      "or returns the most relevant passages, with citations and a source list. Prefer the lower-level " +
      "tools (search_documents, open_document, cite_source) when step-by-step transparency matters.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Free-form question about the user's files" },
      },
      required: ["question"],
    },
    annotations: { readOnlyHint: true },
    execute: async (input, { signal }) => {
      const tool = "ask_my_files";
      try {
        ok(tool, input);
        const question = String(input.question ?? "");
        signal.throwIfAborted();
        const { composeAskAnswer } = await import("./answer");
        const result = await composeAskAnswer(question);
        logActivity({
          tool,
          input,
          status: "ok",
          detail: `${result.sources.length} sources (${result.mode})`,
        });
        return JSON.stringify({ answer: result.answer, sources: result.sources });
      } catch (err) {
        return fail(tool, input, err);
      }
    },
  };
}

export function makeGetStatus(): ModelContextTool {
  return {
    name: "get_crate_status",
    title: "Get Crate status",
    description:
      "Report what is in this Crate: number of indexed documents, file types, whether semantic " +
      "embeddings are active, and which tools are available. Use as the first call to confirm the " +
      "connection and see if any files are indexed yet.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async (_input, { signal }) => {
      const tool = "get_crate_status";
      try {
        ok(tool, {});
        const docs = await listDocs();
        signal.throwIfAborted();
        const kinds: Record<string, number> = {};
        for (const d of docs) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
        const status = {
          documents: docs.length,
          kinds,
          semantic_search: embeddingStatus() === "ready" ? "active" : "unavailable (lexical only)",
          tools_available:
            docs.length === 0
              ? ["get_crate_status"]
              : [
                  "get_crate_status",
                  "search_documents",
                  "open_document",
                  "cite_source",
                  "summarize_doc",
                  "compare_documents",
                  "extract_table",
                  "export_table",
                  "ask_my_files",
                ],
          note: docs.length === 0 ? "The Crate is empty — ask the user to drop a folder." : "Ready.",
        };
        logActivity({ tool, input: {}, status: "ok", detail: `${docs.length} docs` });
        return JSON.stringify(status);
      } catch (err) {
        return fail(tool, {}, err);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Registration lifecycle                                              */
/* ------------------------------------------------------------------ */

const coreAc = new AbortController();
let libraryAc = new AbortController();
let libraryLive = false;

async function registerLibraryTools(): Promise<void> {
  const mc = document.modelContext;
  if (!mc) return;
  if (libraryLive || (await docCount()) === 0) return;
  if (libraryAc.signal.aborted) libraryAc = new AbortController();
  const tools = [
    makeSearchDocuments(),
    makeOpenDocument(),
    makeCiteSource(),
    makeSummarizeDoc(),
    makeCompareDocuments(),
    makeExtractTable(),
    makeExportTable(),
    makeAskMyFiles(),
  ];
  for (const tool of tools) {
    await mc.registerTool(tool, { signal: libraryAc.signal });
  }
  libraryLive = true;
}

async function unregisterLibraryTools(): Promise<void> {
  if (!libraryLive) return;
  libraryAc.abort(); // removes every tool registered under this signal
  libraryLive = false;
}

/** Called on mount and whenever the library changes (ingest done, doc removed). */
export async function syncWebMCPTools(): Promise<boolean> {
  if (typeof document === "undefined" || !document.modelContext) return false;
  try {
    if ((await docCount()) > 0) {
      await registerLibraryTools();
    } else {
      await unregisterLibraryTools();
    }
    return true;
  } catch (err) {
    console.warn("Crate: WebMCP registration failed", err);
    return false;
  }
}

/** Idempotent bootstrap: registers the always-on status tool + toolchange relay. */
export function initWebMCP(): boolean {
  if (typeof document === "undefined" || !document.modelContext) return false;
  const mc = document.modelContext;
  void mc
    .registerTool(makeGetStatus(), { signal: coreAc.signal })
    .then(() => syncWebMCPTools());
  mc.addEventListener("toolchange", () => emit(EVENTS.activity, {
    id: crypto.randomUUID(),
    tool: "toolchange",
    input: {},
    at: Date.now(),
    status: "ok",
    detail: "tool registry changed — agents re-read the tool list",
  }));
  return true;
}
