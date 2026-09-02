"use client";

/**
 * Text extraction for the file types Crate understands. PDFs are read
 * page-by-page with pdf.js; everything text-shaped is read as-is.
 */

import type { CrateKind } from "./types";

export async function extractPdf(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<{ text: string; pages: number }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    let last = 0;
    const lines: string[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform[5];
      if (last !== 0 && Math.abs(y - last) > 2) lines.push("\n");
      lines.push(item.str);
      if (item.hasEOL) lines.push("\n");
      last = y;
    }
    parts.push(`[Page ${p}]\n${lines.join(" ").replace(/[ \t]+\n/g, "\n").trim()}`);
    page.cleanup();
    onProgress?.(p, pdf.numPages);
  }
  return { text: parts.join("\n\n"), pages: pdf.numPages };
}

export async function extractText(file: File): Promise<string> {
  return file.text();
}

/** CSV: normalized into a stable, table-shaped text so search + extract_table work. */
export async function extractCsv(file: File): Promise<string> {
  const raw = await file.text();
  return raw; // kept raw; extract_table parses rows on demand
}

export async function extractFile(
  file: File,
  kind: CrateKind,
  onProgress?: (page: number, total: number) => void,
): Promise<{ text: string; pages?: number }> {
  switch (kind) {
    case "pdf":
      return extractPdf(file, onProgress);
    case "csv":
      return { text: await extractCsv(file) };
    case "image":
    case "unknown":
      return { text: "" };
    default:
      return { text: await extractText(file) };
  }
}
