/**
 * Core domain types for Crate.
 *
 * A "document" is a file the user dropped into the Crate. Its extracted text is
 * split into chunks, which are the unit of indexing, search and citation.
 */

export type CrateKind = "pdf" | "text" | "code" | "markdown" | "csv" | "image" | "unknown";

export interface CrateDoc {
  id: string;
  name: string;
  path: string; // relative path inside the dropped folder
  kind: CrateKind;
  mime: string;
  size: number;
  text: string; // full extracted text ("" for images)
  pages?: number; // PDFs only
  summary?: string; // written by summarize_doc
  addedAt: number;
}

export interface CrateChunk {
  id: string; // `${docId}:${index}`
  docId: string;
  docName: string;
  index: number;
  text: string;
  start: number; // char offset into doc.text
  end: number;
  embedding?: number[]; // only present when the embedding model loaded
}

export interface SearchHit {
  docId: string;
  docName: string;
  chunkId: string;
  snippet: string;
  score: number; // 0..1
  start: number;
  end: number;
}

export interface ActivityEvent {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  at: number;
  status: "running" | "ok" | "error";
  detail?: string;
}

export interface IndexProgress {
  total: number;
  done: number;
  current?: string;
  phase: "extracting" | "embedding" | "ready";
}

/** Payload for the "crate:cite" DOM event, consumed by the document viewer. */
export interface CiteEvent {
  docId: string;
  docName?: string;
  quote: string;
  note?: string;
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export function kindForName(name: string, mime: string): CrateKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (["md", "markdown", "mdx"].includes(ext)) return "markdown";
  if (ext === "csv" || ext === "tsv" || mime === "text/csv") return "csv";
  if (
    [
      "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java",
      "c", "h", "cpp", "hpp", "cs", "swift", "kt", "sh", "sql", "json", "yaml",
      "yml", "toml", "html", "css", "scss", "php", "lua", "r", "dart", "vue",
      "svelte", "prisma", "graphql", "gql", "tf", "env", "lock", "gitignore",
    ].includes(ext)
  ) {
    return "code";
  }
  if (mime.startsWith("text/") || ["txt", "log", "ini", "cfg", "conf", "xml"].includes(ext)) {
    return "text";
  }
  return "unknown";
}
