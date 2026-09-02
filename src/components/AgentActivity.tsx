"use client";

/**
 * AgentActivity — the thin strip that makes agent work visible: a pulse on
 * every tool call and a rolling log of what the agent did.
 */

import { useState } from "react";
import type { ActivityEvent } from "@/lib/types";

export default function AgentActivity({ events }: { events: ActivityEvent[] }) {
  const [open, setOpen] = useState(true);
  const latest = events[0];
  // Keying the pulse on the latest event id restarts the CSS animation on
  // every new tool call — no state, no effects.
  const shown = open ? events.slice(0, 20) : [];

  return (
    <div className="activity">
      <div className="head">
        <span key={latest?.id ?? "idle"} className={`pulse${latest ? " live" : ""}`} />
        <span>Agent activity · {events.length} tool events</span>
        <span style={{ flex: 1 }} />
        <button className="remove-btn" onClick={() => setOpen((o) => !o)}>
          {open ? "hide ▾" : "show ▴"}
        </button>
      </div>
      {open && (
        <div className="log">
          {shown.length === 0 && (
            <div className="log-line">No tool calls yet. Open this page in ChatGPT (or Chrome with the WebMCP flag) and ask your agent something.</div>
          )}
          {shown.map((ev) => (
            <div key={ev.id} className={`log-line${ev.status === "error" ? " error" : ""}`}>
              <span className="tool">{ev.tool}</span>{" "}
              {Object.keys(ev.input).length > 0 && (
                <span>
                  ({Object.entries(ev.input)
                    .slice(0, 2)
                    .map(([k, v]) => `${k}=${JSON.stringify(v)?.slice(0, 60)}`)
                    .join(", ")})
                </span>
              )}{" "}
              → {ev.detail ?? ev.status}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
