import type { BranchNode, Tier } from '@/lib/types';

/**
 * Geometry for the node-graph sidebar.
 *
 * Positions are computed here rather than measured from the DOM because the SVG edges
 * need the same coordinates as the cards. Measuring would mean rendering the cards,
 * reading them back, then re-rendering the edges — two passes on every state change.
 * Fixed per-variant heights buy a single pass; the cards set the same heights, so the
 * stubs always meet a card's vertical centre.
 */

/** Left inset of the root card. Each depth level steps right from here. */
const GUTTER = 20;
const INDENT = 44;
/** Every card ends flush at this x, so deeper nodes are narrower rather than clipped. */
const RIGHT_EDGE = 360;
/** Narrowest a card may get, whatever the depth. */
const MIN_WIDTH = 148;
const TOP = 36;
const GAP = 22;
/** A parent's vertical spine, measured right from its own left edge. */
const SPINE_OFFSET = 24;
/** Corner radius where a child's edge peels off its parent's spine. */
const ELBOW = 9;
/** Breathing room under the last card so the scroll doesn't end flush against it. */
const BOTTOM_PAD = 24;

export const CANVAS_WIDTH = 400;

/*
 * Card heights. These must match what the card actually renders — see NODE_HEIGHT
 * usage in TreeSidebar, which sets them as an explicit style.
 */
const HEIGHT: Record<CardVariant, number> = {
  root: 56,
  branch: 76,
  archived: 50,
};

export type CardVariant = 'root' | 'branch' | 'archived';

export interface PlacedNode {
  node: BranchNode;
  variant: CardVariant;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Vertical run from a parent's bottom edge down past its last child. */
export interface Spine {
  id: string;
  x: number;
  y1: number;
  y2: number;
}

/** The rounded elbow peeling off the parent's spine into one child's left edge. */
export interface Stub {
  id: string;
  /** Ready-to-render SVG path. */
  d: string;
  /** Tier of the child's last answer — the legend's "edge tint". */
  tier: Tier | null;
  /** Archived branches get a dashed edge. */
  dashed: boolean;
}

export interface TreeLayout {
  nodes: PlacedNode[];
  spines: Spine[];
  stubs: Stub[];
  height: number;
}

function variantOf(node: BranchNode): CardVariant {
  if (node.parentId === null) return 'root';
  return node.archived ? 'archived' : 'branch';
}

/**
 * Depth-first from each root, so a node's children sit directly beneath it — the same
 * walk the indented list used, and what puts a branch's subtree above its next sibling.
 */
export function layoutTree(nodes: BranchNode[]): TreeLayout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placed: PlacedNode[] = [];
  const seen = new Set<string>();
  let cursorY = TOP;

  const walk = (node: BranchNode) => {
    if (seen.has(node.id)) return; // defensive: a cycle would otherwise hang the render
    seen.add(node.id);

    const variant = variantOf(node);
    const height = HEIGHT[variant];
    const x = GUTTER + node.depth * INDENT;

    placed.push({
      node,
      variant,
      x,
      y: cursorY,
      width: Math.max(RIGHT_EDGE - x, MIN_WIDTH),
      height,
    });
    cursorY += height + GAP;

    for (const childId of node.childIds) {
      const child = byId.get(childId);
      if (child) walk(child);
    }
  };

  nodes.filter((n) => n.parentId === null).forEach(walk);
  // Anything unreachable from a root still gets rendered rather than silently dropped.
  nodes.forEach((n) => !seen.has(n.id) && walk(n));

  const pos = new Map(placed.map((p) => [p.node.id, p]));
  const spines: Spine[] = [];
  const stubs: Stub[] = [];

  for (const parent of placed) {
    const children = parent.node.childIds
      .map((id) => pos.get(id))
      .filter((c): c is PlacedNode => Boolean(c));
    if (children.length === 0) continue;

    const spineX = parent.x + SPINE_OFFSET;
    const top = parent.y + parent.height;
    const centres = children.map((c) => c.y + c.height / 2);

    spines.push({
      id: parent.node.id,
      x: spineX,
      y1: top,
      // The last child's elbow finishes the run, so stop where that curve begins.
      y2: Math.max(top, Math.max(...centres) - ELBOW),
    });

    for (const child of children) {
      const y = child.y + child.height / 2;
      // Peel off the spine on a quarter-round rather than a hard right angle.
      const start = Math.max(top, y - ELBOW);
      stubs.push({
        id: child.node.id,
        d: `M${spineX} ${start} Q${spineX} ${y} ${spineX + ELBOW} ${y} H${child.x}`,
        tier: child.node.lastTier,
        dashed: child.node.archived,
      });
    }
  }

  return { nodes: placed, spines, stubs, height: cursorY + BOTTOM_PAD };
}
