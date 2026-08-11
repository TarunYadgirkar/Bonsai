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
 * The dotted trail the insight travels along. Bowed towards the origin so it arcs out of
 * the chat and curves into the sidebar rather than cutting a straight diagonal across the
 * pane — the same sweep the mockup draws.
 */
function arcPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const c1 = `${from.x - dx * 0.35} ${from.y - dy * 0.15}`;
  const c2 = `${from.x - dx * 0.7} ${from.y - dy * 0.55}`;
  return `M${from.x} ${from.y} C ${c1}, ${c2}, ${to.x} ${to.y}`;
}

/**
 * The distilled line visibly flows from the branch into the parent node. Viewport-fixed
 * overlay so it can cross from the chat pane into the sidebar; purely decorative
 * (pointer-events-none) — the state change already landed before it starts.
 */
export function MergeFlight({ flight, onDone }: { flight: Flight; onDone: () => void }) {
  const [landed, setLanded] = useState(false);
  /*
   * `landed` flips on the first frame — it starts the pill's transition, it does not mean
   * the pill has arrived. The target ring is keyed off its own timer at TRAVEL_MS so it
   * pops when the pill actually gets there.
   */
  const [arrived, setArrived] = useState(false);
  const doneRef = useRef(onDone);

  useEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(() => {
    // One frame at the origin first, or the browser has nothing to transition from.
    const raf = requestAnimationFrame(() => setLanded(true));
    const arrival = setTimeout(() => setArrived(true), TRAVEL_MS);
    const timer = setTimeout(() => doneRef.current(), TRAVEL_MS + HOLD_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(arrival);
      clearTimeout(timer);
    };
  }, []);

  const point = landed ? flight.to : flight.from;

  return (
    <>
      <svg
        aria-hidden
        className="pointer-events-none fixed inset-0 z-40 h-full w-full"
        style={{
          opacity: arrived ? 0 : 1,
          transition: `opacity ${HOLD_MS}ms ease-out`,
        }}
      >
        <path
          d={arcPath(flight.from, flight.to)}
          stroke="rgba(110,231,183,.28)"
          strokeWidth={1.5}
          strokeDasharray="3 7"
          fill="none"
        />
        {/* Landing ring on the parent node: a soft halo plus the point it settles on. */}
        <circle
          cx={flight.to.x}
          cy={flight.to.y}
          r={26}
          fill="rgba(52,211,153,.10)"
          style={{
            transformBox: 'fill-box',
            transformOrigin: 'center',
            transform: `scale(${arrived ? 1 : 0.3})`,
            opacity: arrived ? 1 : 0,
            transition: 'transform 320ms cubic-bezier(0.22, 0.9, 0.3, 1), opacity 320ms ease-out',
          }}
        />
        <circle
          cx={flight.to.x}
          cy={flight.to.y}
          r={4}
          fill="rgba(110,231,183,.9)"
          style={{ opacity: arrived ? 1 : 0, transition: 'opacity 320ms ease-out' }}
        />
      </svg>

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
    </>
  );
}
