import {
  PersistenceCommitError,
  PersistenceError,
  PersistenceUncertainCommitError,
} from '@/lib/persistence/errors';
import type { ApiError } from '@/lib/types';

export function persistenceErrorResponse(error: unknown): Response | undefined {
  if (error instanceof PersistenceUncertainCommitError) {
    return Response.json(
      {
        error: 'persistence commit outcome uncertain',
        code: 'PERSISTENCE_COMMIT_UNCERTAIN',
      } satisfies ApiError,
      { status: 503 },
    );
  }
  if (error instanceof PersistenceCommitError) {
    return Response.json(
      { error: 'persistence commit failed', code: 'PERSISTENCE_COMMIT_FAILED' } satisfies ApiError,
      { status: 503 },
    );
  }
  if (error instanceof PersistenceError) {
    return Response.json(
      { error: 'persistence unavailable', code: 'PERSISTENCE_UNAVAILABLE' } satisfies ApiError,
      { status: 503 },
    );
  }
  return undefined;
}
