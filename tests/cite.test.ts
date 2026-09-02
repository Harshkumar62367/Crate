import { describe, expect, it } from "vitest";
import { findQuoteRange } from "@/lib/cite";

const DOC = "# Q3 Report\n\nQ3 revenue was $4.2M,   up 18% from Q2.\n\nThe Acme indemnity clause was renewed.";

describe("findQuoteRange", () => {
  it("finds an exact substring and its range round-trips", () => {
    const r = findQuoteRange(DOC, "Acme indemnity clause");
    expect(r).not.toBeNull();
    expect(DOC.slice(r![0], r![1])).toBe("Acme indemnity clause");
  });

  it("is case-insensitive", () => {
    const r = findQuoteRange(DOC, "acme INDEMNITY clause");
    expect(DOC.slice(r![0], r![1])).toBe("Acme indemnity clause");
  });

  it("collapses whitespace differences between quote and source", () => {
    // Source has three spaces after the comma; quote has one.
    const r = findQuoteRange(DOC, "revenue was $4.2M, up 18%");
    expect(r).not.toBeNull();
    expect(DOC.slice(r![0], r![1])).toContain("revenue was $4.2M,");
  });

  it("matches across paragraph breaks", () => {
    const r = findQuoteRange(DOC, "Q3 Report Q3 revenue");
    expect(r).not.toBeNull();
  });

  it("returns null when the quote is absent", () => {
    expect(findQuoteRange(DOC, "the moon is made of cheese")).toBeNull();
  });

  it("returns null for trivially short quotes", () => {
    expect(findQuoteRange(DOC, "Q3 ")).toBeNull();
    expect(findQuoteRange(DOC, "")).toBeNull();
  });

  it("handles ellipsis-prefixed snippets from search results", () => {
    const r = findQuoteRange(DOC, "…The Acme indemnity clause was renewed.");
    expect(r).not.toBeNull();
    expect(DOC.slice(r![0], r![1])).toContain("indemnity");
  });

  it("handles OCR-noisy quotes with newlines", () => {
    const text = "first test: DCR\nclient registered OK";
    const r = findQuoteRange(text, "DCR client registered");
    expect(r).not.toBeNull();
  });
});
