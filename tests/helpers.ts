import { beforeEach } from "vitest";
import "fake-indexeddb/auto"; // installs a per-worker global indexedDB
import { clearAll } from "@/lib/filestore";
import { invalidateSearchCache } from "@/lib/search";

/**
 * Shared setup for tests that touch IndexedDB. Vitest runs each test file in
 * an isolated worker, so the fake-indexeddb global starts fresh per file;
 * individual tests just get an empty store and a cold search cache.
 */
export async function cleanSlate(): Promise<void> {
  await clearAll();
  invalidateSearchCache();
}

beforeEach(async () => {
  await cleanSlate();
});
