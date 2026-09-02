# Crate

> **Drag in a folder. Ask your agent. It just works.**

[![OpenAI WebMCP Challenge](https://img.shields.io/badge/OpenAI_WebMCP_Challenge-entry-1a7f4b)](https://webmcp.devpost.com/)

Crate turns any folder of files — PDFs, code, notes, CSVs, screenshots — into an **agent-native, searchable, citable workspace** with a single drag-and-drop. Files are indexed **entirely in your browser** (nothing is ever uploaded), and Crate registers a set of **WebMCP tools** that any AI agent visiting the page can call: ChatGPT's in-app browser, Chrome with the WebMCP flag, the Nekuda Workbench, Stagehand, and more.

The human sees a beautiful reader. The agent sees typed tools. They share the same session, the same documents, the same cursor.

**Routes:** `/` is the landing page; **`/app` is the workspace**.

## Why WebMCP is load-bearing

Without WebMCP, an agent would have to scrape the DOM or OCR screenshots to work with your files — slow, fragile, hallucinated. With WebMCP, the tools are *declared* via `document.modelContext.registerTool`; the agent *calls* them; the page *executes* them on the user's actual local files with full session state. Every call is visible in the on-page **agent activity strip**, and `cite_source` draws a live **citation ring** around the exact span the answer came from.

## The tools (8 imperative + 2 declarative)

| Tool | Kind | What it does |
|---|---|---|
| `get_crate_status` | imperative | Always-on status check: document count, kinds, which tools are live |
| `search_documents` | imperative | Hybrid BM25 + semantic search, returns ranked snippets with scores |
| `open_document` | imperative | Full text of a doc (or one PDF page); opens it in the viewer |
| `cite_source` | imperative | Rings a quoted span in the viewer so the user sees the anchor |
| `summarize_doc` | imperative, `confirm: true` | Writes a 3-bullet extractive summary to the doc's panel |
| `compare_documents` | imperative | Side-by-side table for 2–5 docs, rendered on the page |
| `extract_table` | imperative | Pulls tabular data out of CSVs / Markdown tables / PDFs as CSV |
| `export_table` | imperative, `confirm: true` | Triggers a real CSV download in the user's browser |
| `ask_my_files` | imperative | One-shot Q&A composing search + cite with inline citations |
| `<form toolname="ask">` | declarative | The persistent ask box (browser synthesizes the schema) |
| `<form toolname="upload_folder">` | declarative | Native file-picker fallback for agents |

Registration is **state-aware**: with an empty Crate only `get_crate_status` exists; the full toolset appears when files are indexed and `toolchange` tells agents to re-read the list. All handlers honor the agent's `AbortSignal`, use `annotations` per the spec (`readOnlyHint` for reads, `untrustedContentHint` on outputs that echo file content, a `confirm` schema field for anything that writes to disk), and log visible activity events.

## Privacy: where the data lives

Nowhere but your browser. Extracted text and embeddings go into **IndexedDB**; nothing is sent to any server — there is no server API at all. Close the tab, come back tomorrow, your Crate is still there. Delete it with one click.

## Search

- **Lexical**: BM25 over ~900-char chunks of extracted text
- **Semantic**: `all-MiniLM-L6-v2` via transformers.js, WebGPU-accelerated when available, WASM fallback — running **in your browser**, no API key
- **Hybrid**: 0.55 × BM25 + 0.45 × cosine, gracefully degrading to lexical-only if the model can't load
- **OCR**: image files (screenshots, photos of whiteboards, scanned docs) are read with tesseract.js — also fully in-browser

## File types

PDF (pdf.js, page-by-page), Markdown, CSV, code (30+ extensions), plain text, **images — OCR'd locally with tesseract.js (WASM) so screenshots become searchable**. Files over 25 MB are skipped. `node_modules`, `.git`, and friends are ignored when you drop a folder.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000 → landing at /, workspace at /app
npm test           # 64 unit tests (vitest): chunking, search ranking, citation
                   # matching, table extraction, filestore, WebMCP tool handlers
```

Or with Docker:

```bash
docker build -t crate . && docker run -p 3000:3000 crate
```

**To see the agent side**, open the URL in an environment where WebMCP is enabled:

- **ChatGPT's in-app browser** (easiest) — ask *"what's in my crate?"*
- **Chrome 149+** with `chrome://flags/#enable-webmcp-testing` → Enabled
- **Nekuda WebMCP Workbench** extension — inspect and call tools manually
- **Model Context Tool Inspector** extension — natural-language agent for testing

Without WebMCP, everything except the agent-facing tool registry still works: drop files, search, ask, read — the badge in the header tells you WebMCP is off and how to enable it.

## Testing notes

- Install deps, run dev, drop a folder.
- First semantic search downloads the ~25 MB model once (cached afterwards).
- Try: *"find every doc that mentions revenue and quote the number"* → the agent should run `search_documents` → `open_document` → `cite_source`, and you'll see the ring animate.

## Stack

Next.js (App Router) · TypeScript · `idb` (IndexedDB) · pdf.js · transformers.js · papaparse · hand-rolled CSS (paper/ink/green, Space Grotesk + JetBrains Mono). No backend, no auth, no API keys.

## License

MIT — see [LICENSE](LICENSE).
