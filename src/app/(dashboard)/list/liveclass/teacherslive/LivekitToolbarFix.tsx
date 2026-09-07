"use client";

import { useEffect } from "react";

const SELECTORS = [
  '[data-lk-theme] .lk-toolbar',
  '.lk-toolbar',
  '.livekit-toolbar',
  '.lk-controls',
  '.lk-video-conference__toolbar',
  '.lk-video-conference__controls',
];

function markNode(node: Element | null) {
  if (!node) return;
  try {
    node.classList.add("compact-livekit-toolbar");
  } catch (e) {
    /* ignore silently */
  }
}

export default function LivekitToolbarFix() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let mounted = true;

    function applyToExisting() {
      try {
        const nodes = document.querySelectorAll(SELECTORS.join(","));
        nodes.forEach(n => markNode(n as Element));
      } catch (e) {
        // noop
      }
    }

    // initial attempt with a slight delay to let LiveKit mount
    const t = window.setTimeout(() => applyToExisting(), 120);

    // Observe DOM additions and re-apply class when toolbar appears/changes
    const obs = new MutationObserver(() => {
      if (!mounted) return;
      applyToExisting();
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // Also re-apply on resize (useful when responsive classes change)
    const onResize = () => applyToExisting();
    window.addEventListener("resize", onResize);

    // Run once immediately as well
    applyToExisting();

    return () => {
      mounted = false;
      clearTimeout(t);
      obs.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return null;
}
