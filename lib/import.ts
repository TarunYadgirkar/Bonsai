/**
 * Garden import: the inverse of lib/export.ts's JSON, plus Espalier's export. Everything in the
 * file is untrusted, so it is schema-checked and size-capped, every id is replaced, and the
 * result is only ever ADDED to a session (imported roots become extra trees). Inference logs in
 * the file are ignored: the ledger only counts what this deployment actually ran.
 */
import { MODELS, QUESTION_KINDS, canonicalModelId } from 'bonsai-engine';
import { z } from 'zod';
import type { Conversation, Insight, Message, QuestionKind } from './types';

// Commit writes one row per query, so the row caps keep a full import well inside a minute.
export const IMPORT_LIMITS = {
  bytes: 2_000_000,
  conversations: 100,
  messagesPerConversation: 400,
  messages: 1000,
  insights: 300,
} as const;

const id = z.string().min(1).max(120);
const tier = z.enum(['quick', 'thoughtful', 'deep']);
const effort = z.enum(['low', 'medium', 'high', 'max']);
const count = z.number().int().nonnegative().max(100_000_000);
// Bonsai stores ISO strings; Espalier stores epoch milliseconds.
const timestamp = z.union([z.string().max(40), z.number().int().nonnegative()]).optional();

const routing = z.object({
  tier,
  model: z.string().max(80),
  effort: effort.optional(),
  modelLabel: z.string().max(80).optional(),
  label: z.string().max(120).optional(),
  servedBy: z.string().max(120).optional(),
  fellBackFrom: z.string().max(120).optional(),
  effortNote: z.string().max(200).default(''),
  contextTokens: count.default(0),
  estCostUsd: z.number().nonnegative().max(100_000).default(0),
  reason: z.string().max(2000).default(''),
  complexity: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  escalated: z.boolean().default(false),
  overridden: z.boolean().default(false),
  coveredByBrief: z.boolean().optional(),
  widened: z.boolean().optional(),
  learned: z.boolean().optional(),
  classifiedTier: tier.optional(),
  kind: z.enum(QUESTION_KINDS as [QuestionKind, ...QuestionKind[]]).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const message = z.object({
  id,
  role: z.enum(['user', 'assistant']),
  content: z.string().max(32_000),
  // A routing record is decoration on the chip; a malformed one is dropped, not fatal.
  routing: routing.optional().catch(undefined),
  createdAt: timestamp,
});

const brief = z.object({
  selection: z.string().max(2000),
  markdown: z.string().max(24_000),
  facts: z.array(z.string().max(500)).max(24),
  excludedNote: z.string().max(2000).default(''),
  availableTokens: count,
  briefTokens: count,
  prunedPct: z.number().min(0).max(100),
  anchorMessageId: id.optional(),
  curated: z.boolean().optional(),
  recalled: z.array(z.object({ text: z.string().max(1000), source: z.string().max(200) })).max(12).optional(),
});

const insight = z.object({ id, branchId: id, text: z.string().min(1).max(1000), createdAt: timestamp });

const modeSelection = z.object({
  mode: z.enum(['auto', 'manual']),
  model: z.string().max(80).optional(),
  effort: effort.optional(),
});

const conversation = z.object({
  id,
  title: z.string().max(200),
  parentId: id.nullable(),
  profile: z
    .object({
      name: z.string().max(200),
      context: z.string().max(4000),
      goals: z.array(z.string().max(500)).max(20),
    })
    .optional(),
  messages: z.array(message).max(IMPORT_LIMITS.messagesPerConversation),
  brief: brief.optional(),
  insights: z.array(insight).max(100).default([]),
  pinnedTier: tier.nullable().default(null),
  pinnedMode: modeSelection.nullable().optional(),
  archived: z.boolean().default(false),
});

export const GardenImportSchema = z.object({
  format: z.enum(['bonsai-garden@1', 'espalier-garden@1']),
  conversations: z.array(conversation).min(1).max(IMPORT_LIMITS.conversations),
});

type ImportedConversation = z.infer<typeof conversation>;

export type ImportResult = { ok: true; conversations: Conversation[] } | { ok: false; error: string };

export function parseGardenImport(raw: unknown, mintId: (prefix: string) => string): ImportResult {
  const parsed = GardenImportSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue?.path.join('.') || 'file'}: ${issue?.message ?? 'invalid garden'}` };
  }
  const { conversations } = parsed.data;
  const messages = conversations.reduce((sum, c) => sum + c.messages.length, 0);
  if (messages > IMPORT_LIMITS.messages) {
    return { ok: false, error: `too many messages (${messages}; the limit is ${IMPORT_LIMITS.messages})` };
  }
  const insights = conversations.reduce((sum, c) => sum + c.insights.length, 0);
  if (insights > IMPORT_LIMITS.insights) {
    return { ok: false, error: `too many insights (${insights}; the limit is ${IMPORT_LIMITS.insights})` };
  }
  if (new Set(conversations.map((c) => c.id)).size !== conversations.length) {
    return { ok: false, error: 'two conversations share an id' };
  }
  const ordered = parentsFirst(conversations);
  if (!ordered) return { ok: false, error: 'the branches form a loop' };
  return { ok: true, conversations: remap(ordered, mintId) };
}

/**
 * Topological order, parents before children, so inserts satisfy the parent foreign key. A
 * parent missing from the file (a single-branch export) makes that branch a root. Null on a cycle.
 */
function parentsFirst(conversations: ImportedConversation[]): ImportedConversation[] | null {
  const byId = new Map(conversations.map((c) => [c.id, c]));
  const placed = new Set<string>();
  const out: ImportedConversation[] = [];
  for (const start of conversations) {
    const chain: ImportedConversation[] = [];
    const seen = new Set<string>();
    let cursor: ImportedConversation | undefined = start;
    while (cursor && !placed.has(cursor.id)) {
      if (seen.has(cursor.id)) return null;
      seen.add(cursor.id);
      chain.push(cursor);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    for (const c of chain.reverse()) {
      placed.add(c.id);
      out.push(c);
    }
  }
  return out;
}

function isoTime(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** A pin on a model this deployment does not serve (an Espalier Gemini id) falls back to auto. */
function catalogPin(pin: ImportedConversation['pinnedMode']): Conversation['pinnedMode'] {
  if (!pin || pin.mode === 'auto') return pin ?? null;
  const known = pin.model && MODELS.some((m) => m.id === canonicalModelId(pin.model!));
  return known ? pin : null;
}

function remap(ordered: ImportedConversation[], mintId: (prefix: string) => string): Conversation[] {
  const conversationIds = new Map(ordered.map((c) => [c.id, mintId('conv')]));
  const messageIds = new Map<string, string>();
  for (const c of ordered) for (const m of c.messages) messageIds.set(m.id, mintId('msg'));

  return ordered.map((c): Conversation => {
    const nextId = conversationIds.get(c.id)!;
    const messages = c.messages.map(
      (m): Message => ({
        id: messageIds.get(m.id)!,
        role: m.role,
        content: m.content,
        ...(m.routing ? { routing: m.routing } : {}),
        ...(isoTime(m.createdAt) ? { createdAt: isoTime(m.createdAt) } : {}),
      }),
    );
    const insights = c.insights.map(
      (i): Insight => ({
        id: mintId('ins'),
        branchId: conversationIds.get(i.branchId) ?? nextId,
        parentId: nextId,
        text: i.text,
        createdAt: isoTime(i.createdAt) ?? new Date().toISOString(),
      }),
    );
    const anchor = c.brief?.anchorMessageId ? messageIds.get(c.brief.anchorMessageId) : undefined;
    return {
      id: nextId,
      title: c.title.trim() || 'Imported conversation',
      parentId: c.parentId ? (conversationIds.get(c.parentId) ?? null) : null,
      ...(c.profile ? { profile: c.profile } : {}),
      messages,
      ...(c.brief
        ? {
            brief: {
              ...c.brief,
              id: mintId('brief'),
              branchId: nextId,
              anchorMessageId: anchor,
            },
          }
        : {}),
      insights,
      pinnedTier: c.pinnedTier,
      pinnedMode: catalogPin(c.pinnedMode),
      archived: c.archived,
    };
  });
}
