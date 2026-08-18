/**
 * Route boundary: schema-validated bodies, uniform ApiError responses, no unhandled throws.
 */
import { z } from 'zod';
import type { ApiError } from './types';

export const ModeSelectionSchema = z.object({
  mode: z.enum(['auto', 'manual']),
  model: z.string().max(80).optional(),
  effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
});

export const ChatRequestSchema = z.object({
  branchId: z.string().min(1).max(120),
  content: z.string().min(1).max(8000),
  pinnedTier: z.enum(['quick', 'thoughtful', 'deep']).nullish(),
  mode: ModeSelectionSchema.optional(),
});

export const BranchRequestSchema = z.object({
  parentId: z.string().min(1).max(120),
  selection: z.string().min(1).max(2000),
  question: z.string().max(8000).optional(),
  title: z.string().max(200).optional(),
  mode: ModeSelectionSchema.optional(),
  anchorMessageId: z.string().max(120).optional(),
});

export const MergeRequestSchema = z.object({
  branchId: z.string().min(1).max(120),
  archive: z.boolean().optional(),
});

export const NewConversationRequestSchema = z.object({
  title: z.string().max(200).optional(),
});

export const MessageActionRequestSchema = z
  .object({
    branchId: z.string().min(1).max(120),
    messageId: z.string().min(1).max(120),
    op: z.enum(['regenerate', 'edit']),
    /** Replacement text — required for 'edit', ignored for 'regenerate'. */
    content: z.string().min(1).max(8000).optional(),
    pinnedTier: z.enum(['quick', 'thoughtful', 'deep']).nullish(),
    mode: ModeSelectionSchema.optional(),
  })
  .refine((b) => b.op !== 'edit' || Boolean(b.content?.trim()), {
    message: 'edit requires content',
    path: ['content'],
  });

export const NodeActionRequestSchema = z
  .object({
    id: z.string().min(1).max(120),
    op: z.enum(['rename', 'archive', 'unarchive']),
    title: z.string().max(200).optional(),
  })
  .refine((b) => b.op !== 'rename' || Boolean(b.title?.trim()), {
    message: 'rename requires title',
    path: ['title'],
  });

export function apiError(message: string, status: number): Response {
  return Response.json({ error: message } satisfies ApiError, { status });
}

/** Mutations that a configured database failed to take must not read as success. */
export function persistenceError(): Response {
  return apiError('state not persisted — database write failed', 503);
}

export function apiRoute<T>(
  schema: z.ZodType<T> | null,
  handler: (body: T, request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      let body = undefined as T;
      if (schema) {
        const raw = await request.json().catch(() => null);
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          return apiError(
            issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'invalid body',
            400,
          );
        }
        body = parsed.data;
      }
      return await handler(body, request);
    } catch (err) {
      console.error('[api] unhandled', err);
      return apiError('internal error', 500);
    }
  };
}
