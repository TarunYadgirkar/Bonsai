import { apiRoute } from '@/lib/api';
import { loadPopulationPrior, type PopulationPrior } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * The community routing prior — the anonymous aggregate every new session cold-starts from.
 * Public by design: it contains only summed behavioral counters (no session ids, no text) and is
 * withheld entirely below the contributor threshold, so nothing individual can be read back out.
 * Other surfaces (plugin, extension) can consume this to share the same cold-start.
 */
export const GET = apiRoute(null, async () => {
  const body: PopulationPrior = await loadPopulationPrior();
  return Response.json(body, {
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300' },
  });
});
