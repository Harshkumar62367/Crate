import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/filestore";

describe("chunkText", () => {
  it("returns nothing for empty or whitespace-only text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  \t ")).toEqual([]);
  });

  it("returns a single chunk covering short text", () => {
    const chunks = chunkText("Hello world, this is a short note.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].start).toBe(0);
    expect(chunks[0].text).toBe("Hello world, this is a short note.");
  });

  it("always yields chunks whose text equals the source slice", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} with some filler content.`).join("\n\n");
    const chunks = chunkText(text, 200, 40);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(text.slice(c.start, c.end)).toBe(c.text);
      expect(c.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("advances monotonically and never loops forever on paragraph-less text", () => {
    const text = "x".repeat(5000);
    const chunks = chunkText(text, 900, 120);
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start).toBeGreaterThan(chunks[i - 1].start);
    }
  });

  it("prefers breaking at paragraph boundaries near the target size", () => {
    const p = (s: string) => s + "\n\n";
    const text = p("a".repeat(300)) + p("b".repeat(300)) + p("c".repeat(300)) + "d".repeat(300);
    const chunks = chunkText(text, 350, 50);
    // The first chunk should end at or before the start of the second paragraph.
    expect(chunks[0].end).toBeLessThanOrEqual(302);
  });

  it("handles CJK text without spaces", () => {
    const text = "这是一段很长的中文内容。".repeat(200);
    const chunks = chunkText(text, 900, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(text.slice(c.start, c.end)).toBe(c.text);
  });

  it("handles a single huge line without memory blowup", () => {
    const chunks = chunkText("y".repeat(100_000), 900, 100);
    expect(chunks.length).toBeGreaterThan(100);
    const totalCovered = chunks[chunks.length - 1].end;
    expect(totalCovered).toBeGreaterThanOrEqual(99_000);
  });
});
