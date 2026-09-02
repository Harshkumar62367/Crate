import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { cleanSlate } from "./helpers";
import { chunkText, putDoc } from "@/lib/filestore";
import { searchDocuments, summarizeExtractively, topTerms } from "@/lib/search";
import type { CrateDoc } from "@/lib/types";

const { embedQueryMock } = vi.hoisted(() => ({ embedQueryMock: vi.fn() }));

vi.mock("@/lib/embeddings", () => ({
  embedQuery: embedQueryMock,
  // vectors are pre-normalized; similarity is a plain dot product
  cosine: (a: number[], b: number[]) => a.reduce((d, x, i) => d + x * b[i], 0),
}));

async function seedDoc(name: string, text: string, embedding?: number[]): Promise<CrateDoc> {
  const d: CrateDoc = {
    id: crypto.randomUUID(),
    name,
    path: name,
    kind: "text",
    mime: "text/plain",
    size: text.length,
    text,
    addedAt: Date.now(),
  };
  const chunks = chunkText(text).map((c, i) => ({
    id: `${d.id}:${i}`,
    docId: d.id,
    docName: name,
    index: i,
    embedding,
    ...c,
  }));
  await putDoc(d, chunks);
  return d;
}

beforeEach(async () => {
  await cleanSlate();
  embedQueryMock.mockResolvedValue(null); // lexical-only by default
});

describe("searchDocuments (lexical-only)", () => {
  it("returns [] for empty or punctuation-only queries", async () => {
    await seedDoc("a.txt", "revenue grew in July");
    expect(await searchDocuments("", 10)).toEqual([]);
    expect(await searchDocuments("   ", 10)).toEqual([]);
    expect(await searchDocuments("!!! @@@ ###", 10)).toEqual([]);
  });

  it("returns [] on an empty crate", async () => {
    expect(await searchDocuments("anything", 10)).toEqual([]);
  });

  it("ranks a strong term match above a weak one and drops non-matches", async () => {
    await seedDoc("strong.txt", "acme indemnity clause acme indemnity clause acme indemnity");
    await seedDoc("weak.txt", "the acme contract exists somewhere here");
    await seedDoc("unrelated.txt", "completely different topic about gardening tools");
    const hits = await searchDocuments("acme indemnity clause", 10);
    expect(hits[0].docName).toBe("strong.txt");
    expect(hits.some((h) => h.docName === "unrelated.txt")).toBe(false);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await seedDoc(`d${i}.txt`, `shared keyword document number ${i} with more text`);
    }
    expect((await searchDocuments("shared keyword", 2)).length).toBe(2);
    expect((await searchDocuments("shared keyword", 50)).length).toBe(5);
  });

  it("returns snippets containing the matched term", async () => {
    await seedDoc("a.txt", "the indemnity clause protects both parties in the contract");
    const [hit] = await searchDocuments("indemnity", 5);
    expect(hit.snippet.toLowerCase()).toContain("indemnity");
    expect(hit.score).toBeGreaterThan(0);
    expect(hit.score).toBeLessThanOrEqual(1);
  });

  it("is case-insensitive and ignores stopwords", async () => {
    await seedDoc("a.txt", "The Board Approved the Q3 Hiring Plan");
    expect((await searchDocuments("board approved hiring", 5)).length).toBe(1);
    expect((await searchDocuments("the", 5)).length).toBe(0); // stopword only
  });
});

describe("searchDocuments (hybrid with embeddings)", () => {
  it("surfaces a lexically-unmatched doc whose embedding aligns with the query", async () => {
    // Doc A matches lexically; doc B has no shared words but a perfect embedding.
    await seedDoc("lexical.txt", "acme revenue numbers");
    await seedDoc("semantic.txt", "completely unrelated words", [1, 0, 0]);
    embedQueryMock.mockResolvedValue([1, 0, 0]);
    const hits = await searchDocuments("acme revenue numbers", 10);
    const sem = hits.find((h) => h.docName === "semantic.txt");
    expect(sem).toBeDefined();
    expect(sem!.score).toBeGreaterThan(0.3);
  });

  it("keeps lexical docs ranked when the query has no embedding match", async () => {
    await seedDoc("lexical.txt", "acme revenue numbers");
    await seedDoc("semantic.txt", "completely unrelated words", [0, 1, 0]);
    embedQueryMock.mockResolvedValue([1, 0, 0]); // orthogonal to B
    const hits = await searchDocuments("acme revenue numbers", 10);
    expect(hits[0].docName).toBe("lexical.txt");
    expect(hits.some((h) => h.docName === "semantic.txt")).toBe(false);
  });

  it("drops sub-floor semantic noise (gibberish queries yield no hits)", async () => {
    await seedDoc("a.txt", "gardening tips for spring", [0.2, 0.1, 0]); // cosine 0.2 < floor 0.3
    embedQueryMock.mockResolvedValue([1, 0, 0]);
    expect(await searchDocuments("zzzqqqxxx gibberish", 10)).toEqual([]);
  });

  it("still surfaces semantically strong matches above the floor", async () => {
    // No lexical overlap with the query at all — pure semantic pass.
    await seedDoc("a.txt", "gamma delta epsilon", [0.9, 0.1, 0]); // cosine 0.9
    embedQueryMock.mockResolvedValue([1, 0, 0]);
    const hits = await searchDocuments("alpha beta", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].score).toBeCloseTo(0.45 * 0.9, 2);
  });
});

describe("summarizeExtractively", () => {
  it("returns at most `bullets` sentences", () => {
    const text = "One. Two. Three. Four. Five. Six.";
    expect(summarizeExtractively(text, undefined, 3).length).toBeLessThanOrEqual(3);
  });

  it("biases toward sentences matching the query", async () => {
    const text =
      "The weather was mild. " +
      "Revenue reached $4.2M in Q3. " +
      "A cat sat on the mat. " +
      "Revenue grew 18% quarter over quarter. " +
      "Lunch was sandwiches.";
    const picked = summarizeExtractively(text, "revenue", 2);
    expect(picked.every((s) => s.toLowerCase().includes("revenue"))).toBe(true);
  });

  it("handles empty and single-sentence text", () => {
    expect(summarizeExtractively("", "q", 3)).toEqual([]);
    const single = "This single sentence is definitely long enough to be summarized properly.";
    expect(summarizeExtractively(single, "q", 3)).toEqual([single]);
  });
});

describe("topTerms", () => {
  it("returns distinctive terms for a document", async () => {
    await seedDoc("a.txt", "giraffe zebra giraffe elephant giraffe savanna wildlife");
    await seedDoc("b.txt", "quarterly revenue report quarterly revenue report revenue");
    const { listDocs } = await import("@/lib/filestore");
    const a = (await listDocs()).find((d) => d.name === "a.txt")!;
    const terms = await topTerms(a.id, 5);
    expect(terms).toContain("giraffe");
  });

  it("returns [] for an unknown doc", async () => {
    await seedDoc("a.txt", "hello world");
    expect(await topTerms("nope", 5)).toEqual([]);
  });
});
