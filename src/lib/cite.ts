/**
 * Citation locating — find a quoted span inside a document's text, ignoring
 * whitespace differences (OCR output and PDF extraction often differ from
 * what an agent copies back). Shared by the viewer and tests.
 */

/** Find `quote` inside `text` ignoring whitespace differences; returns char range. */
export function findQuoteRange(text: string, quote: string): [number, number] | null {
  // Strip the ellipses our own search snippets add before matching.
  const q = normalizeWhitespace(quote)
    .replace(/^[…\s]+|[…\s]+$/g, "")
    .trim();
  if (q.length < 4) return null;
  const flat: number[] = []; // flat index -> original index (whitespace runs collapse to one)
  let flatStr = "";
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      flatStr += " ";
      flat.push(i);
      while (i + 1 < text.length && /\s/.test(text[i + 1])) i++;
    } else {
      flatStr += text[i];
      flat.push(i);
    }
    i++;
  }
  const at = flatStr.toLowerCase().indexOf(q.toLowerCase());
  if (at === -1) return null;
  const start = flat[at];
  const endIdx = Math.min(at + q.length - 1, flat.length - 1);
  return [start, flat[endIdx] + 1];
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ");
}
