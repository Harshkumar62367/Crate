// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { cleanSlate } from "./helpers";
import { chunkText, getDoc, putDoc } from "@/lib/filestore";
import {
  makeAskMyFiles,
  makeCiteSource,
  makeExportTable,
  makeGetStatus,
  makeOpenDocument,
  makeSummarizeDoc,
} from "@/lib/webmcp";
import type { CrateDoc } from "@/lib/types";

const { embedQueryMock } = vi.hoisted(() => ({ embedQueryMock: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({
  embedQuery: embedQueryMock,
  embeddingStatus: () => "unavailable" as const,
  cosine: (a: number[], b: number[]) => a.reduce((d, x, i) => d + x * b[i], 0),
}));

const signal = () => new AbortController().signal;

async function seedDoc(partial: Partial<CrateDoc>): Promise<CrateDoc> {
  const text = partial.text ?? "";
  const d: CrateDoc = {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? "doc.txt",
    path: partial.path ?? partial.name ?? "doc.txt",
    kind: partial.kind ?? "text",
    mime: "text/plain",
    size: text.length,
    addedAt: Date.now(),
    ...partial,
    text,
  };
  await putDoc(d, chunkText(text).map((c, i) => ({
    id: `${d.id}:${i}`, docId: d.id, docName: d.name, index: i, ...c,
  })));
  return d;
}

beforeEach(async () => {
  await cleanSlate();
  embedQueryMock.mockResolvedValue(null);
  // jsdom has no object URL implementation
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

describe("summarize_doc handler", () => {
  it("refuses to run without confirm=true", async () => {
    const tool = makeSummarizeDoc();
    const out = JSON.parse(await tool.execute({ doc: "a.txt" }, { signal: signal() }));
    expect(out.error).toContain("confirm");
  });

  it("writes an extractive summary when confirmed", async () => {
    const d = await seedDoc({
      name: "a.txt",
      text: "The board approved the plan. Revenue reached $4.2M. Churn fell to 2.1%. Hiring continues.",
    });
    const tool = makeSummarizeDoc();
    const out = JSON.parse(await tool.execute({ doc: "a.txt", confirm: true }, { signal: signal() }));
    expect(out.summary.length).toBeGreaterThan(0);
    expect(out.summary.length).toBeLessThanOrEqual(3);
    const stored = await getDoc(d.id);
    expect(stored?.summary).toContain("•");
  });

  it("errors for unknown docs even when confirmed", async () => {
    const tool = makeSummarizeDoc();
    const out = JSON.parse(await tool.execute({ doc: "ghost.txt", confirm: true }, { signal: signal() }));
    expect(out.error).toContain("No document matches");
  });
});

describe("export_table handler", () => {
  it("refuses without confirm=true", async () => {
    const tool = makeExportTable();
    const out = JSON.parse(
      await tool.execute({ content: "a,b", filename: "x.csv", confirm: false }, { signal: signal() }),
    );
    expect(out.error).toContain("confirm");
  });

  it("downloads a sanitized file when confirmed", async () => {
    const clicks: string[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === "a") {
        (el as HTMLAnchorElement).click = () => clicks.push((el as HTMLAnchorElement).download);
      }
      return el;
    });
    const tool = makeExportTable();
    const out = JSON.parse(
      await tool.execute(
        { content: "a,b\n1,2", filename: "../evil name.csv", confirm: true },
        { signal: signal() },
      ),
    );
    expect(out).toEqual({ downloaded: ".._evil_name.csv", bytes: 7 });
    expect(clicks).toEqual([".._evil_name.csv"]);
    vi.restoreAllMocks();
  });
});

describe("open_document handler", () => {
  it("returns full text and emits openDoc", async () => {
    const d = await seedDoc({ name: "notes.txt", text: "alpha beta gamma " .repeat(50) });
    const opened: string[] = [];
    window.addEventListener("crate:open-doc", (e) => opened.push((e as CustomEvent).detail), { once: true });
    const tool = makeOpenDocument();
    const out = JSON.parse(await tool.execute({ doc: "notes.txt" }, { signal: signal() }));
    expect(out.doc_id).toBe(d.id);
    expect(out.text).toContain("alpha");
    await new Promise((r) => setTimeout(r, 10));
    expect(opened).toEqual([d.id]);
  });

  it("slices a single PDF page when asked", async () => {
    await seedDoc({ name: "deck.pdf", kind: "pdf", pages: 3, text: "[Page 1]\nintro\n\n[Page 2]\nrevenue table\n\n[Page 3]\nappendix" });
    const tool = makeOpenDocument();
    const out = JSON.parse(await tool.execute({ doc: "deck.pdf", page: 2 }, { signal: signal() }));
    expect(out.text).toContain("[Page 2]");
    expect(out.text).toContain("revenue table");
    expect(out.text).not.toContain("appendix");
  });

  it("truncates very long documents with a note", async () => {
    await seedDoc({ name: "big.txt", text: "z".repeat(20_000) });
    const tool = makeOpenDocument();
    const out = JSON.parse(await tool.execute({ doc: "big.txt" }, { signal: signal() }));
    expect(out.text.length).toBe(6000);
    expect(out.note).toContain("6000");
  });
});

describe("cite_source handler", () => {
  it("emits a cite event with doc + quote", async () => {
    await seedDoc({ name: "a.txt", text: "the indemnity clause protects both parties" });
    const seen: Array<{ docId: string; quote: string }> = [];
    window.addEventListener("crate:cite", (e) => seen.push((e as CustomEvent).detail), { once: true });
    const tool = makeCiteSource();
    const out = JSON.parse(
      await tool.execute({ doc: "a.txt", quote: "indemnity clause protects" }, { signal: signal() }),
    );
    expect(out.cited).toBe("a.txt");
    await new Promise((r) => setTimeout(r, 10));
    expect(seen[0].quote).toBe("indemnity clause protects");
  });
});

describe("ask_my_files handler", () => {
  it("composes an answer with citations and cites the top source", async () => {
    await seedDoc({ name: "q3.txt", text: "Q3 revenue was $4.2M and churn improved." });
    await seedDoc({ name: "q2.txt", text: "Q2 revenue was $3.6M." });
    const cited: string[] = [];
    window.addEventListener("crate:cite", (e) => cited.push((e as CustomEvent).detail.docName), { once: true });
    const tool = makeAskMyFiles();
    const out = JSON.parse(await tool.execute({ question: "revenue" }, { signal: signal() }));
    expect(out.answer).toContain("[q3.txt]");
    expect(out.sources.length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 10));
    // Exactly one source rings the viewer: whatever ranked first.
    expect(cited).toEqual([out.sources[0].doc]);
  });

  it("answers honestly when nothing matches", async () => {
    await seedDoc({ name: "a.txt", text: "gardening tips for spring" });
    const tool = makeAskMyFiles();
    const out = JSON.parse(await tool.execute({ question: "quantum chromodynamics" }, { signal: signal() }));
    expect(out.answer).toContain("Nothing in your Crate matches that");
    expect(out.sources).toHaveLength(0);
  });
});

describe("get_crate_status handler", () => {
  it("reports an empty crate", async () => {
    const tool = makeGetStatus();
    const out = JSON.parse(await tool.execute({}, { signal: signal() }));
    expect(out.documents).toBe(0);
    expect(out.tools_available).toEqual(["get_crate_status"]);
    expect(out.note).toContain("empty");
  });

  it("reports counts, kinds and the full toolset after ingest", async () => {
    await seedDoc({ name: "a.pdf", kind: "pdf", text: "hello" });
    await seedDoc({ name: "b.csv", kind: "csv", text: "a,b" });
    const tool = makeGetStatus();
    const out = JSON.parse(await tool.execute({}, { signal: signal() }));
    expect(out.documents).toBe(2);
    expect(out.kinds).toEqual({ pdf: 1, csv: 1 });
    expect(out.tools_available).toContain("search_documents");
    expect(out.tools_available).toContain("ask_my_files");
  });
});
