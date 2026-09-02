"use client";

/**
 * TaglineReveal — scroll-activated, word-by-word text reveal.
 * IntersectionObserver flips words from dim to ink as the block enters the
 * viewport; the transition delay makes it read left to right.
 */

import { useEffect, useRef } from "react";

export default function TaglineReveal({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const words = el.querySelectorAll<HTMLElement>(".lp-word");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            words.forEach((w, i) => {
              setTimeout(() => w.classList.add("on"), i * 70);
            });
            io.disconnect();
          }
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [text]);

  return (
    <p ref={ref} className="lp-reveal">
      {text.split(" ").map((word, i) => (
        <span key={i} className="lp-word">
          {word}{" "}
        </span>
      ))}
    </p>
  );
}
