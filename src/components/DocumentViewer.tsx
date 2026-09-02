"use client";

/**
 * DocumentViewer — renders a document's extracted text and draws the animated
 * citation ring when cite_source (or a search jump) targets a span, using the
 * CSS Custom Highlight API (Chrome 105+).
 */

import { useEffect, useRef } from "react";
import { findQuoteRange } from "@/lib/cite";
import type { CrateDoc } from "@/lib/types";

interface CiteRequest {
  docId: string;
  quote: string;
  n: number;
}

interface Props {
  doc: CrateDoc | null;
  citeRequest: CiteRequest | null;
  openRequest: { id: string; n: number } | null;
}

export default function DocumentViewer({ doc, citeRequest, openRequest }: Props) {
  const textRef = useRef<HTMLDivElement>(null);

  // ::highlight() isn't parsed by bundler CSS pipelines yet, so the rule is
  // injected as an inline <style> in the JSX below.
  const highlightCss =
    "::highlight(crate-cite){background:rgba(26,127,75,.12);text-decoration:underline;text-decoration-color:rgba(26,127,75,.55);text-decoration-thickness:3px;text-underline-offset:4px;}";

  // Draw the citation ring for the latest cite request.
  useEffect(() => {
    if (!citeRequest || !doc || citeRequest.docId !== doc.id || !textRef.current) return;
    const node = textRef.current.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE || typeof CSS === "undefined" || !("highlights" in CSS)) {
      return;
    }
    const range = findQuoteRange(doc.text, citeRequest.quote);
    if (!range) return;
    const r = new Range();
    r.setStart(node, range[0]);
    r.setEnd(node, Math.min(range[1], node.textContent?.length ?? 0));
    const highlights = CSS.highlights as unknown as Map<string, Highlight>;
    const highlight = new Highlight(r);
    highlights.set("crate-cite", highlight);
    // Scroll the first highlighted line into view.
    const rect = r.getBoundingClientRect();
    const containerRect = textRef.current.getBoundingClientRect();
    textRef.current.scrollBy({
      top: rect.top - containerRect.top - 80,
      behavior: "smooth",
    });
    const t = setTimeout(() => highlights.delete("crate-cite"), 8000);
    return () => {
      clearTimeout(t);
      highlights.delete("crate-cite");
    };
  }, [citeRequest, doc]);

  // Reset scroll when the document is (re)opened.
  useEffect(() => {
    if (openRequest && textRef.current) textRef.current.scrollTop = 0;
  }, [openRequest]);

  if (!doc) {
    return (
      <>
        <div className="card-title">
          <span>Document</span>
        </div>
        <div className="doc-empty">
          <div className="glyph">📄</div>
          <div>
            Drop a folder on the left, then open a file here — or let your agent call
            <br />
            <code>open_document</code> and watch it appear.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: highlightCss }} />
      <div className="card-title">
        <span title={doc.path}>{doc.name}</span>
        <span>
          {doc.kind}
          {doc.pages ? ` · ${doc.pages} pages` : ""} · {doc.size < 1024 ? `${doc.size} B` : `${(doc.size / 1024).toFixed(0)} KB`}
        </span>
      </div>
      <div ref={textRef} className="doc-text">
        {doc.text || `(no readable text — ${doc.kind === "image" ? "OCR found nothing in this image" : "binary file"})`}
      </div>
      {doc.summary && (
        <div className="summary-panel visible">
          <div className="label">Agent summary</div>
          {doc.summary}
        </div>
      )}
    </>
  );
}
