import { persistenceErrorResponse } from '@/app/api/persistence-response';
import { resetStore } from '@/lib/store';
import type { StateResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Put the demo back to its opening state: the seeded root plus the pre-built scenario tree,
 * nothing a rehearsal added.
 *
 * Deleting the KV snapshot by hand is NOT equivalent — a warm lambda still holds the old tree in
 * globalThis and writes it straight back on the next request. This clears both, in that order,
 * and returns the fresh state so the caller can render it without a second round trip.
 */
export async function POST(): Promise<Response> {
  try {
    const state = await resetStore();
    return Response.json(state satisfies StateResponse);
  } catch (error: unknown) {
    const response = persistenceErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
