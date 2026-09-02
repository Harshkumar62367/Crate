import Link from "next/link";
import TaglineReveal from "@/components/TaglineReveal";

const TOOLS = [
  "search_documents",
  "open_document",
  "cite_source",
  "summarize_doc",
  "compare_documents",
  "extract_table",
  "export_table",
  "ask_my_files",
  "get_crate_status",
];

const AGENTS = ["ChatGPT", "Chrome", "Nekuda Workbench", "Stagehand", "Claude"];

const FAQ = [
  {
    q: "Do my files get uploaded anywhere?",
    a: "No. There is no upload endpoint in the codebase. Text extraction, OCR, embeddings and search all run inside your browser tab. Data is stored in your browser's IndexedDB and stays on your machine.",
  },
  {
    q: "What do I need to make the agent work?",
    a: "Open the site in ChatGPT's in-app browser, or Chrome 149+ with the WebMCP testing flag enabled, or any agent that speaks WebMCP. Without one of those, everything except agent invocation still works: drop, search, ask, read.",
  },
  {
    q: "Which file types does Crate understand?",
    a: "PDFs (page by page), images (OCR'd locally, so screenshots become searchable), Markdown, CSV, code in 30+ languages, and plain text. Files over 25 MB are skipped.",
  },
  {
    q: "What does WebMCP change compared to screen scraping?",
    a: "The agent calls typed functions with JSON schemas instead of guessing at pixels and DOM. It is faster, more reliable, and runs on your session with your files, while you watch every call happen on the page.",
  },
];

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-header">
        <div className="logo">
          Crate<span className="accent">.</span>
        </div>
        <nav className="lp-nav">
          <a href="#how">How it works</a>
          <a href="#tools">Tools</a>
          <a href="#faq">FAQ</a>
          <a href="https://github.com/Harshkumar62367/Crate" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <Link href="/app" className="btn">
          Open Crate
        </Link>
      </header>

      {/* Hero: product promise + live-feeling preview above the fold */}
      <section className="lp-hero">
        <div className="lp-hero-copy">
          <div className="lp-eyebrow">
            <span className="lp-dot" /> WebMCP native · OpenAI WebMCP Challenge
          </div>
          <h1>
            Drag in a folder.
            <br />
            Ask your agent.
          </h1>
          <p className="lp-sub">
            Crate turns any folder of files into a searchable, citable workspace for
            you and your AI agent. Everything runs in your browser. Nothing is ever
            uploaded.
          </p>
          <div className="lp-cta">
            <Link href="/app" className="btn lp-big">
              Open Crate →
            </Link>
            <a href="#how" className="btn secondary lp-big">
              How it works
            </a>
          </div>
          <div className="lp-hero-meta">
            No account · No API key · No upload · MIT licensed
          </div>
        </div>

        {/* CSS-only product preview: the demo above the fold */}
        <div className="lp-preview" aria-hidden="true">
          <div className="lp-preview-card">
            <div className="lp-preview-title">try-webmcp · 8 files</div>
            <div className="lp-preview-row">
              <span className="kind-chip">image</span> e2e-16-green.jpg <span className="lp-ok">OCR ✓</span>
            </div>
            <div className="lp-preview-row">
              <span className="kind-chip">pdf</span> lease-2026.pdf <span className="lp-ok">3 pages ✓</span>
            </div>
            <div className="lp-preview-agent">
              <span className="lp-agent-tool">search_documents</span>
              <span className="lp-agent-tool">open_document</span>
              <span className="lp-agent-tool">cite_source</span>
              <div className="lp-agent-answer">
                “1. DCR — client registered” <span className="lp-ring-demo">cited</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bento grid */}
      <section className="lp-bento" id="tools">
        <div className="lp-card lp-span2">
          <div className="lp-card-tag">Privacy</div>
          <h3>Your files never leave your browser</h3>
          <p>
            There is no server API. Text extraction, OCR, embeddings and search all
            run inside the tab. Your data sits in IndexedDB on your machine and is
            gone when you clear it.
          </p>
        </div>
        <div className="lp-card">
          <div className="lp-card-tag">The agent side</div>
          <h3>11 declared tools</h3>
          <div className="lp-tools">
            {TOOLS.map((t) => (
              <code key={t}>{t}</code>
            ))}
            <code className="lp-tool-form">form toolname=&quot;ask&quot;</code>
            <code className="lp-tool-form">form toolname=&quot;upload_folder&quot;</code>
          </div>
        </div>
        <div className="lp-card">
          <div className="lp-card-tag">Trust</div>
          <h3>Answers with proof</h3>
          <p>
            cite_source draws a green ring around the exact span the answer came
            from, live in the viewer, while you watch.
          </p>
        </div>
        <div className="lp-card">
          <div className="lp-card-tag">Search</div>
          <h3>Hybrid by default</h3>
          <p>
            BM25 keywords plus MiniLM embeddings on WebGPU, degrading gracefully to
            lexical only when the model is unavailable.
          </p>
        </div>
        <div className="lp-card">
          <div className="lp-card-tag">Images</div>
          <h3>Screenshots become searchable</h3>
          <p>
            Every image is {"OCR'd"} locally with tesseract.js. That folder of whiteboard
            photos is now a queryable corpus.
          </p>
        </div>
        <div className="lp-card">
          <div className="lp-card-tag">Agents</div>
          <h3>Works with your agent</h3>
          <div className="lp-agents">
            {AGENTS.map((a) => (
              <span key={a}>{a}</span>
            ))}
          </div>
          <p>Same URL, same session, same files. The agent inherits your browser.</p>
        </div>
        <div className="lp-card">
          <div className="lp-card-tag">Safety</div>
          <h3>Reads are read. Writes confirm.</h3>
          <p>
            Every tool carries spec annotations. The two mutating tools require the
            agent to ask you first, then pass confirm.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="lp-how" id="how">
        <h2>How it works</h2>
        <div className="lp-steps">
          <div className="lp-step">
            <div className="lp-step-n">1</div>
            <h3>Drop</h3>
            <p>Drag any folder onto the page. Crate walks it, skips the junk, reads every file locally.</p>
          </div>
          <div className="lp-step">
            <div className="lp-step-n">2</div>
            <h3>Index</h3>
            <p>Text is extracted, OCR runs, everything is chunked and embedded in your browser. The toolset goes live.</p>
          </div>
          <div className="lp-step">
            <div className="lp-step-n">3</div>
            <h3>Ask</h3>
            <p>Your agent searches, opens, cites and exports. You watch every call in the activity strip.</p>
          </div>
        </div>
      </section>

      {/* Tagline reveal */}
      <section className="lp-reveal-section">
        <TaglineReveal text="Your files were always yours. Now they speak agent." />
      </section>

      {/* FAQ */}
      <section className="lp-faq" id="faq">
        <h2>Questions judges ask</h2>
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>

      {/* Final CTA */}
      <section className="lp-final">
        <h2>Open the live app. Drop a folder. Ask.</h2>
        <Link href="/app" className="btn lp-big">
          Open Crate →
        </Link>
      </section>

      <footer className="lp-footer">
        <span>
          Crate<span className="accent">.</span> Built for the OpenAI WebMCP Challenge.
        </span>
        <a href="https://github.com/Harshkumar62367/Crate" target="_blank" rel="noreferrer" className="lp-mono">
          github.com/Harshkumar62367/Crate
        </a>
        <span className="lp-mono">MIT · no servers were harmed</span>
      </footer>
    </div>
  );
}
