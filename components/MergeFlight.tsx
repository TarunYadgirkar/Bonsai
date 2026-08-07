'use client';

import { useEffect, useRef, useState } from 'react';

export interface Flight {
  /** Insight id — also the React key, so a second merge remounts rather than resumes. */
  id: string;
  text: string;
  parentId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

const TRAVEL_MS = 950;
const HOLD_MS = 260;

/**
 * DEMO.md Beat 4: the distilled line visibly flows from the branch into the parent node.
 * Viewport-fixed overlay so it can cross from the chat pane into the sidebar; purely
 * decorative (pointer-events-none) — the state change already landed before it starts.
 */
export function MergeFlight({ flight, onDone }: { flight: Flight; onDone: () => void }) {
  const [landed, setLanded] = useState(false);
  const doneRef = useRef(onDone);

  useEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(() => {
    // One frame at the origin first, or the browser has nothing to transition from.
    const raf = requestAnimationFrame(() => setLanded(true));
    const timer = setTimeout(() => doneRef.current(), TRAVEL_MS + HOLD_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, []);

  const point = landed ? flight.to : flight.from;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-50"
      style={{
        transform: `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -50%) scale(${
          landed ? 0.55 : 1
        })`,
        opacity: landed ? 0 : 1,
        transition: `transform ${TRAVEL_MS}ms cubic-bezier(0.22, 0.9, 0.3, 1), opacity ${TRAVEL_MS}ms ease-in`,
      }}
    >
      <div className="max-w-sm rounded-2xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-2.5 text-center text-xs leading-snug text-emerald-50 shadow-xl backdrop-blur-sm">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-emerald-300/80">
          Merging insight
        </div>
        {flight.text}
      </div>
    </div>
  );
}
