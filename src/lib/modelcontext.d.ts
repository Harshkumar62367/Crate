/**
 * Minimal typings for the W3C WebMCP draft spec
 * (https://webmachinelearning.github.io/webmcp). Kept local so the app builds
 * and runs whether or not the browser ships `document.modelContext` yet.
 */

interface ModelContextToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

interface ModelContextTool {
  name: string; // 1-128 chars, [A-Za-z0-9._-]
  title?: string;
  description: string;
  inputSchema?: object;
  execute: (input: Record<string, unknown>, context: { signal: AbortSignal }) => Promise<string>;
  annotations?: ModelContextToolAnnotations;
}

interface RegisteredTool extends ModelContextTool {
  origin?: string;
}

interface ModelContextRegisterToolOptions {
  signal?: AbortSignal;
}

interface ModelContext {
  registerTool(tool: ModelContextTool, options?: ModelContextRegisterToolOptions): Promise<undefined>;
  getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredTool[]>;
  executeTool(
    tool: RegisteredTool,
    input?: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
  addEventListener(type: "toolchange", listener: () => void): void;
  removeEventListener(type: "toolchange", listener: () => void): void;
}

interface Document {
  readonly modelContext?: ModelContext;
}
