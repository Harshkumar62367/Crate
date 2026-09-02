import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto"; // installs the indexedDB global for filestore
import { tableFromDoc, makeExtractTable } from "@/lib/webmcp";
import type { CrateDoc } from "@/lib/types";

function doc(partial: Partial<CrateDoc>): CrateDoc {
  return {
    id: "d1",
    name: "doc",
    path: "doc",
    kind: "text",
    mime: "text/plain",
    size: 100,
    text: "",
    addedAt: 0,
    ...partial,
  };
}

describe("tableFromDoc", () => {
  it("passes CSV content through untouched", () => {
    const d = doc({ kind: "csv", text: "month,revenue\nJuly,1.3M\nAugust,1.4M" });
    expect(tableFromDoc(d)).toBe("month,revenue\nJuly,1.3M\nAugust,1.4M");
  });

  it("converts a markdown table to CSV and drops the separator row", () => {
    const d = doc({
      kind: "markdown",
      text: "Intro line\n\n| Name | Score |\n| --- | --- |\n| Ana | 91 |\n| Bo | 84 |\n",
    });
    const csv = tableFromDoc(d);
    const rows = csv.split("\n");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe('"Name","Score"');
    expect(rows[1]).toBe('"Ana","91"');
    expect(rows[2]).toBe('"Bo","84"');
  });

  it("escapes double quotes in cells", () => {
    const d = doc({ kind: "markdown", text: "| He said | \"hi\" |\n| --- | --- |\n| a | b |" });
    expect(tableFromDoc(d)).toContain('"He said","""hi"""');
  });

  it("detects tab-separated text", () => {
    const d = doc({ kind: "pdf", text: "[Page 2]\nName\tQty\tPrice\nBolt\t12\t0.10\nNut\t9\t0.05" });
    const csv = tableFromDoc(d);
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv.split("\n")[0]).toBe('"Name","Qty","Price"');
  });

  it("returns empty string for prose without tabular structure", () => {
    const d = doc({ kind: "text", text: "Just a paragraph.\nAnother line of prose.\nNothing tabular here." });
    expect(tableFromDoc(d)).toBe("");
  });
});

describe("extract_table tool handler", () => {
  it("returns a CSV payload for a CSV document", async () => {
    const { putDoc } = await import("@/lib/filestore");
    const d = doc({ id: "csvdoc", name: "data.csv", kind: "csv", text: "a,b\n1,2" });
    await putDoc(d, []);
    const tool = makeExtractTable();
    const out = JSON.parse(
      await tool.execute({ doc: "data.csv" }, { signal: new AbortController().signal }),
    );
    expect(out.doc).toBe("data.csv");
    expect(out.csv).toBe("a,b\n1,2");
  });

  it("errors clearly for an unknown document", async () => {
    const tool = makeExtractTable();
    const out = JSON.parse(
      await tool.execute({ doc: "nope.pdf" }, { signal: new AbortController().signal }),
    );
    expect(out.error).toContain("No document matches");
  });
});
