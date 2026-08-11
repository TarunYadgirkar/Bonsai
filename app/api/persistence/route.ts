import { PersistenceError } from '@/lib/persistence/errors';
import type { PersistenceStatus } from '@/lib/persistence/types';
import { loadStore, persistenceStatus } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  let loadError: PersistenceError | undefined;
  try {
    await loadStore();
  } catch (error: unknown) {
    if (!(error instanceof PersistenceError)) throw error;
    loadError = error;
  }
  try {
    const status = persistenceStatus();
    const response: PersistenceStatus =
      loadError && status.health !== 'error'
        ? { ...status, health: 'error', message: 'persistence is unavailable' }
        : status;
    return Response.json(response);
  } catch (error: unknown) {
    const response = persistenceErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
import { persistenceErrorResponse } from '@/app/api/persistence-response';
