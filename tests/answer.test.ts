// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { cleanSlate } from "./helpers";
import { chunkText, putDoc } from "@/lib/filestore";
import { composeAskAnswer, extractNumberedItems } from "@/lib/answer";
import type { CrateDoc } from "@/lib/types";

const { embedQueryMock } = vi.hoisted(() => ({ embedQueryMock: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({
  embedQuery: embedQueryMock,
  embeddingStatus: () => "unavailable" as const,
  cosine: (a: number[], b: number[]) => a.reduce((d, x, i) => d + x * b[i], 0),
}));

const E2E_TEXT = [
  "PS C:\\Users\\harsh\\Zcode-folder\\murmur> node scripts/e2e-oauth.mjs --headless --user harsh",
  "=== AuthPlane scripted OAuth flow ===",
  "J 1. DCR — client registered: NJhOrsMnS6LCRI1BpNFIHA",
  "J 2. PKCE — S256 challenge ready",
  "J 3. authorize → 303 /login",
  "…",
  "J 15. list-recent (after delete) 2/16 contacts",
  "J 16. who-am-i — Signed in as user",
].join("\n");

async function seed(name: string, text: string): Promise<CrateDoc> {
  const d: CrateDoc = {
    id: crypto.randomUUID(),
    name,
    path: name,
    kind: "image",
    mime: "image/jpeg",
    size: text.length,
    text,
    addedAt: Date.now(),
  };
  await putDoc(
    d,
    chunkText(text).map((c, i) => ({
      id: `${d.id}:${i}`,
      docId: d.id,
      docName: name,
      index: i,
      ...c,
    })),
  );
  return d;
}

beforeEach(async () => {
  await cleanSlate();
  embedQueryMock.mockResolvedValue(null);
});

describe("extractNumberedItems", () => {
  it("parses OCR numbered lines with letter/check prefixes", () => {
    const items = extractNumberedItems(E2E_TEXT);
    expect(items.length).toBe(5); // 1, 2, 3, 15, 16 — steps 4–14 are elided in the fixture
    expect(items[0]).toEqual({ n: 1, line: "1. DCR — client registered: NJhOrsMnS6LCRI1BpNFIHA" });
    expect(items[items.length - 1].n).toBe(16);
  });

  it("ignores decimals like 3.6M and huge numbers", () => {
    const items = extractNumberedItems("rent is 3.6M total\n12345. nope\n2. real item");
    expect(items).toHaveLength(1);
    expect(items[0].n).toBe(2);
  });
});

describe("composeAskAnswer — ordinal questions over numbered lists", () => {
  it("answers 'first … of the 16 tests' with item 1 and cites the doc", async () => {
    await seed("e2e-16-green.jpg", E2E_TEXT);
    await seed("isolation-maya-empty.jpg", 'No contacts matched "Sam". Try a different keyword, or ask Claude to add the contact first.');
    const cited: string[] = [];
    window.addEventListener("crate:cite", (e) => cited.push((e as CustomEvent).detail.docName), { once: true });

    const result = await composeAskAnswer("what was the first test of the 16 tests that we wrote");

    expect(result.mode).toBe("list");
    expect(result.answer).toContain("DCR");
    expect(result.answer).toContain("16");
    expect(result.sources[0].doc).toBe("e2e-16-green.jpg");
    await new Promise((r) => setTimeout(r, 10));
    expect(cited).toEqual(["e2e-16-green.jpg"]);
  });

  it("answers 'last' with the highest numbered item", async () => {
    await seed("e2e-16-green.jpg", E2E_TEXT);
    const result = await composeAskAnswer("what was the last step in the run");
    expect(result.mode).toBe("list");
    expect(result.answer).toContain("who-am-i");
  });

  it("falls back to passages for non-ordinal questions", async () => {
    await seed("a.txt", "acme revenue was strong this quarter");
    const result = await composeAskAnswer("acme revenue");
    expect(result.mode).toBe("passages");
    expect(result.answer).toContain("[a.txt]");
  });
});
