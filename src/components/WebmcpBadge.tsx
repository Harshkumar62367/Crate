"use client";

import { useEffect, useState } from "react";

/**
 * WebmcpBadge — shows whether document.modelContext is live in this browser
 * and how many tools are currently registered. Doubles as the instructions
 * surface when it is not.
 */

const INSTRUCTIONS =
  "WebMCP is not enabled in this browser. Test in ChatGPT's in-app browser, or Chrome 149+ " +
  "with chrome://flags/#enable-webmcp-testing enabled, or the Nekuda Workbench extension.";

export default function WebmcpBadge({ on, toolCount }: { on: boolean | null; toolCount: number }) {
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (!showHelp) return;
    const t = setTimeout(() => setShowHelp(false), 6000);
    return () => clearTimeout(t);
  }, [showHelp]);

  return (
    <div
      className={`mcp-badge ${on ? "on" : "off"}`}
      title={on ? "WebMCP is live" : INSTRUCTIONS}
      onClick={() => setShowHelp((s) => !s)}
    >
      <span className="dot" />
      {on === null ? "checking WebMCP…" : on ? `WebMCP · ${toolCount} tools` : "WebMCP off"}
      {showHelp && !on && (
        <span style={{ maxWidth: 320, whiteSpace: "normal" }}>{INSTRUCTIONS}</span>
      )}
    </div>
  );
}
