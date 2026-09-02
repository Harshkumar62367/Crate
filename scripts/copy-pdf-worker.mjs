/**
 * Keeps public/pdf.worker.min.mjs in sync with the installed pdfjs-dist
 * version. Runs on postinstall; a mismatch between the library and the
 * served worker causes runtime worker errors.
 */
import { existsSync, statSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "..", "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = join(root, "..", "public", "pdf.worker.min.mjs");

if (!existsSync(src)) {
  console.warn("[copy-pdf-worker] pdfjs-dist not installed yet — skipping");
  process.exit(0);
}

mkdirSync(dirname(dest), { recursive: true });

const needsCopy =
  !existsSync(dest) || statSync(src).size !== statSync(dest).size || statSync(src).mtimeMs > statSync(dest).mtimeMs;

if (needsCopy) {
  copyFileSync(src, dest);
  console.log("[copy-pdf-worker] synced pdf.worker.min.mjs → public/");
} else {
  console.log("[copy-pdf-worker] worker already up to date");
}
