"use client";

/**
 * Local OCR for images via tesseract.js — runs entirely in the browser
 * (WASM), so image contents become searchable without anything leaving the
 * machine. The worker, WASM core and English language data are fetched from
 * the public CDN once and cached by the browser afterwards.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TesseractWorker = any;

let workerPromise: Promise<TesseractWorker> | null = null;

async function createOcrWorker(): Promise<TesseractWorker> {
  const { createWorker } = await import("tesseract.js");
  return createWorker("eng", 1, {
    logger: () => {}, // progress is reported per-file by ocrImage
  });
}

function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createOcrWorker().catch((err: unknown) => {
      workerPromise = null; // allow retry on next image
      throw err;
    });
  }
  return workerPromise;
}

export async function ocrImage(
  image: File | Blob,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
  onProgress?.(1);
  return data?.text ?? "";
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } finally {
    workerPromise = null;
  }
}
