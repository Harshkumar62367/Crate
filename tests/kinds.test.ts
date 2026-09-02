import { describe, expect, it } from "vitest";
import { kindForName, MAX_FILE_BYTES } from "@/lib/types";

describe("kindForName", () => {
  it("detects PDFs by mime and by extension", () => {
    expect(kindForName("a.pdf", "application/pdf")).toBe("pdf");
    expect(kindForName("a.pdf", "")).toBe("pdf");
  });

  it("detects images by mime", () => {
    expect(kindForName("shot.jpg", "image/jpeg")).toBe("image");
    expect(kindForName("shot.PNG", "image/png")).toBe("image");
  });

  it("maps common extensions", () => {
    expect(kindForName("readme.md", "text/plain")).toBe("markdown");
    expect(kindForName("Component.TSX", "")).toBe("code");
    expect(kindForName("data.csv", "text/csv")).toBe("csv");
    expect(kindForName("notes.txt", "text/plain")).toBe("text");
    expect(kindForName("app.yaml", "")).toBe("code");
  });

  it("treats unknown binaries as unknown", () => {
    expect(kindForName("virus.exe", "application/octet-stream")).toBe("unknown");
    expect(kindForName("archive.zip", "")).toBe("unknown");
  });

  it("falls back to text for extensions without a mime", () => {
    expect(kindForName("server.log", "")).toBe("text");
    expect(kindForName("config.xml", "")).toBe("text");
  });

  it("has a sane 25MB cap constant", () => {
    expect(MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
  });
});
