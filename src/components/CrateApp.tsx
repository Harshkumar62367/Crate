"use client";

/**
 * CrateApp — the client hub. Owns UI state, wires the file pipeline to the
 * DOM-event bus, bootstraps WebMCP, and renders the two-pane workspace.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import DocumentViewer from "./DocumentViewer";
import AgentActivity from "./AgentActivity";
import WebmcpBadge from "./WebmcpBadge";
import { EVENTS, on } from "@/lib/bus";
import { composeAskAnswer } from "@/lib/answer";
import { clearAll, listDocs } from "@/lib/filestore";
import { ingestDrop, removeDoc } from "@/lib/ingest";
import { initWebMCP, syncWebMCPTools } from "@/lib/webmcp";
import { searchDocuments } from "@/lib/search";
import type { ActivityEvent, CrateDoc, IndexProgress, SearchHit } from "@/lib/types";

interface CompareRow {
  doc: string;
  best_matching_snippet: string;
  distinctive_terms: string[];
  pages?: number;
}

export default function CrateApp() {
  const [docs, setDocs] = useState<CrateDoc[]>([]);
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [query, setQuery] = useState("");
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [mcpOn, setMcpOn] = useState<boolean | null>(null);
  const [toolCount, setToolCount] = useState(0);
  const [compare, setCompare] = useState<{ question: string; rows: CompareRow[] } | null>(null);
  const [answer, setAnswer] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openDocRequestId, setOpenDocRequestId] = useState<{ id: string; n: number } | null>(null);
  const [citeRequest, setCiteRequest] = useState<{ docId: string; quote: string; n: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshDocs = useCallback(async () => {
    setDocs(await listDocs());
    // Re-sync the agent-facing tool list shortly after the store settles.
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void syncWebMCPTools().then(setMcpOn), 150);
  }, []);

  /* ---------- bootstrap ---------- */
  useEffect(() => {
    const t = setTimeout(() => {
      void refreshDocs();
      setMcpOn(initWebMCP());
    }, 0);
    return () => clearTimeout(t);
  }, [refreshDocs]);

  /* ---------- bus subscriptions ---------- */
  useEffect(() => {
    const offs = [
      on<IndexProgress>(EVENTS.progress, (p) => {
        setProgress(p);
        if (p.phase === "ready") {
          setBusy(false);
          void refreshDocs();
        }
      }),
      on<ActivityEvent>(EVENTS.activity, (ev) => {
        setActivity((prev) => [ev, ...prev].slice(0, 60));
        if (ev.tool === "toolchange") {
          void document.modelContext
            ?.getTools()
            .then((tools) => setToolCount(tools.length))
            .catch(() => {});
        }
      }),
      on<string>(EVENTS.openDoc, (docId) => {
        setSelectedId(docId);
        setOpenDocRequestId((prev) => ({ id: docId, n: (prev?.n ?? 0) + 1 }));
      }),
      on<{ docId: string; quote: string }>(EVENTS.cite, ({ docId, quote }) => {
        setSelectedId(docId);
        setCiteRequest((prev) => ({ docId, quote, n: (prev?.n ?? 0) + 1 }));
      }),
      on<{ question: string; rows: CompareRow[] }>(EVENTS.compare, setCompare),
    ];
    return () => offs.forEach((off) => off());
  }, [refreshDocs]);

  /* ---------- ingestion ---------- */
  const ingest = useCallback(
    async (dt: DataTransfer | null, files?: FileList | File[]) => {
      setBusy(true);
      setAnswer("");
      try {
        await ingestDrop(dt, files ?? []);
      } catch (err) {
        console.error("Crate: ingestion failed", err);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void ingest(e.dataTransfer);
  };

  /* ---------- local search ---------- */
  const runSearch = useCallback(async (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setHits([]);
      return;
    }
    setHits(await searchDocuments(q, 12));
  }, []);

  const jumpToHit = (hit: SearchHit) => {
    setSelectedId(hit.docId);
    setCiteRequest((prev) => ({
      docId: hit.docId,
      quote: hit.snippet.replace(/^…|…$/g, "").trim(),
      n: (prev?.n ?? 0) + 1,
    }));
  };

  /* ---------- human-side ask (same pipeline ask_my_files runs) ---------- */
  const onAskSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const question = String(fd.get("question") ?? "").trim();
    if (!question) return;
    e.currentTarget.reset();
    setAnswer("Searching your files…");
    try {
      const { answer } = await composeAskAnswer(question);
      setAnswer(answer);
    } catch (err) {
      setAnswer(`Search failed: ${String(err)}`);
    }
  };

  const onRemoveDoc = async (id: string) => {
    await removeDoc(id);
    await refreshDocs();
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  const onClearAll = async () => {
    await clearAll();
    setDocs([]);
    setHits([]);
    setSelectedId(null);
    setCompare(null);
    setAnswer("");
    void syncWebMCPTools();
  };

  const selected = docs.find((d) => d.id === selectedId) ?? null;

  return (
    <div
      className="shell"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <header className="header">
        <div className="logo">
          Crate<span className="accent">.</span>
        </div>
        <div className="tagline">Drag in a folder. Ask your agent. It just works.</div>
        <div className="spacer" />
        <WebmcpBadge on={mcpOn} toolCount={toolCount} />
        {docs.length > 0 && (
          <button className="btn secondary" onClick={onClearAll}>
            Clear crate
          </button>
        )}
      </header>

      <div className="main">
        <aside className="pane">
          <div className={`dropzone${dragOver ? " over" : ""}`} onClick={() => fileInputRef.current?.click()}>
            <div className="big">{busy ? "Indexing…" : "Drop a folder here"}</div>
            <div className="hint">or click to pick files · nothing leaves your browser</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden-input"
            onChange={(e) => {
              void ingest(null, e.target.files ?? []);
              e.target.value = "";
            }}
          />

          {progress && (
            <div className="card">
              <div className="progress-line">
                {progress.phase} · {progress.done}/{progress.total}
                {progress.current ? ` · ${progress.current}` : ""}
              </div>
              <div className="bar">
                <div
                  className="fill"
                  style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : "0%" }}
                />
              </div>
            </div>
          )}

          <div className="card card-docs">
            <div className="card-title">
              <span>Documents</span>
              <span>{docs.length}</span>
            </div>
            <div className="searchbar">
              <input
                type="search"
                placeholder="Search your files…"
                value={query}
                onChange={(e) => void runSearch(e.target.value)}
              />
            </div>
            <div className="filelist">
              {hits.length > 0
                ? hits.map((h) => (
                    <div key={h.chunkId} className="hit-row" onClick={() => jumpToHit(h)}>
                      <span className="doc">{h.docName}</span> <span className="score">{h.score.toFixed(2)}</span>
                      <div className="snippet">{h.snippet}</div>
                    </div>
                  ))
                : docs.map((d) => (
                    <div
                      key={d.id}
                      className={`file-row${d.id === selectedId ? " active" : ""}`}
                      onClick={() => setSelectedId(d.id)}
                    >
                      <span className="kind-chip">{d.kind}</span>
                      <span className="name" title={d.path}>
                        {d.name}
                      </span>
                      <span className="meta">{d.size < 1024 ? `${d.size} B` : `${(d.size / 1024).toFixed(0)} KB`}</span>
                      <button
                        className="remove-btn"
                        title="Remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onRemoveDoc(d.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
              {docs.length === 0 && (
                <div className="doc-empty" style={{ padding: 18 }}>
                  <div className="glyph">🗂</div>
                  <div>PDFs, code, notes, CSVs, images. Empty until you drop something.</div>
                </div>
              )}
            </div>
          </div>

          {/* Declarative WebMCP tool #1: the browser synthesizes an "ask" tool from this form. */}
          <div className="card card-ask">
            <div className="card-title">
              <span>Ask your files</span>
              <span>form toolname=&quot;ask&quot;</span>
            </div>
            <div className="askpanel">
              <form toolname="ask" tooldescription="Ask a question across all files in the Crate. Returns the most relevant passages with citations." toolautosubmit="" onSubmit={onAskSubmit}>
                <input
                  name="question"
                  toolparamdescription="Free-form question about the user's files"
                  placeholder="e.g. what was Q3 revenue?"
                  required
                />
                <button type="submit">Ask</button>
              </form>
              <div className={`ask-answer${answer ? " visible" : ""}`}>{answer}</div>
            </div>
          </div>
          {/* Declarative WebMCP tool #2: agents can trigger the native file picker. */}
          <form
            toolname="upload_folder"
            tooldescription="Open the native file picker so the user can add files to the Crate. Indexing happens locally in the browser."
            className="hidden-input"
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.querySelector<HTMLInputElement>('input[type="file"]');
              if (input?.files?.length) void ingest(null, input.files);
            }}
          >
            <input
              type="file"
              name="files"
              toolparamdescription="Files to add to the Crate"
              multiple
              onChange={(e) => {
                if (e.target.files?.length) void ingest(null, e.target.files);
                e.target.value = "";
              }}
            />
          </form>
        </aside>

        <section className="pane">
          <div className="card viewer">
            <DocumentViewer doc={selected} citeRequest={citeRequest} openRequest={openDocRequestId} />
            {compare && (
              <div className="compare-wrap">
                <div className="card-title" style={{ paddingLeft: 0 }}>
                  <span>Comparison · {compare.question}</span>
                  <button className="remove-btn" onClick={() => setCompare(null)}>
                    ×
                  </button>
                </div>
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Best matching passage</th>
                      <th>Distinctive terms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compare.rows.map((r) => (
                      <tr key={r.doc}>
                        <td>{r.doc}</td>
                        <td>{r.best_matching_snippet}</td>
                        <td>{r.distinctive_terms.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      <AgentActivity events={activity} />
    </div>
  );
}
