import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { cleanSlate } from "./helpers";
import { chunkText, deleteDoc, docCount, findDocByName, listChunks, putDoc, resolveDoc, updateDoc } from "@/lib/filestore";
import type { CrateDoc } from "@/lib/types";

function makeDoc(partial: Partial<CrateDoc>): CrateDoc {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name ?? "doc.txt",
    path: partial.path ?? partial.name ?? "doc.txt",
    kind: partial.kind ?? "text",
    mime: "text/plain",
    size: 10,
    text: partial.text ?? "",
    addedAt: Date.now(),
    ...partial,
  };
}

async function seed(text: string, name = "a.txt"): Promise<CrateDoc> {
  const d = makeDoc({ name, path: name, text });
  const chunks = chunkText(text).map((c, i) => ({
    id: `${d.id}:${i}`,
    docId: d.id,
    docName: d.name,
    index: i,
    ...c,
  }));
  await putDoc(d, chunks);
  return d;
}

beforeEach(async () => {
  await cleanSlate();
});

describe("filestore", () => {
  it("stores docs and their chunks", async () => {
    const d = await seed("hello world ".repeat(50));
    expect(await docCount()).toBe(1);
    const chunks = await listChunks();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.docId === d.id)).toBe(true);
  });

  it("replacing a doc removes its old chunks", async () => {
    const d = await seed("first version ".repeat(80));
    const before = (await listChunks()).length;
    await putDoc({ ...d, text: "second version" }, chunkText("second version").map((c, i) => ({
      id: `${d.id}:${i}`, docId: d.id, docName: d.name, index: i, ...c,
    })));
    const after = (await listChunks()).length;
    expect(after).toBeLessThan(before);
    expect(after).toBe(1);
  });

  it("deleteDoc removes doc and chunks", async () => {
    const d = await seed("some content ".repeat(60));
    await deleteDoc(d.id);
    expect(await docCount()).toBe(0);
    expect(await listChunks()).toHaveLength(0);
  });

  it("updateDoc persists metadata like summaries", async () => {
    const d = await seed("content");
    await updateDoc({ ...d, summary: "• point one" });
    const again = await findDocByName("a.txt");
    expect(again?.summary).toBe("• point one");
  });
});

describe("resolveDoc", () => {
  it("resolves by exact id", async () => {
    const d = await seed("text", "report.pdf");
    expect((await resolveDoc(d.id))?.name).toBe("report.pdf");
  });

  it("resolves by exact name", async () => {
    await seed("text", "report.pdf");
    expect((await resolveDoc("report.pdf"))?.name).toBe("report.pdf");
  });

  it("resolves by name case-insensitively", async () => {
    await seed("text", "Q3-Board-Deck.PDF");
    expect((await resolveDoc("q3-board-deck.pdf"))?.name).toBe("Q3-Board-Deck.PDF");
  });

  it("resolves by unique name suffix", async () => {
    await seed("a", "2026-financials-final.pdf");
    expect((await resolveDoc("financials-final.pdf"))?.name).toBe("2026-financials-final.pdf");
  });

  it("resolves by path", async () => {
    const d = makeDoc({ name: "x.md", path: "docs/deep/x.md", text: "t" });
    await putDoc(d, []);
    expect((await resolveDoc("docs/deep/x.md"))?.id).toBe(d.id);
  });

  it("returns undefined for misses", async () => {
    await seed("a", "one.txt");
    expect(await resolveDoc("two.txt")).toBeUndefined();
    expect(await resolveDoc("")).toBeUndefined();
  });
});
