import { beforeAll, describe, expect, it, vi } from 'vitest';
import { exportJson } from '../lib/export';
import { GARDEN_LIMITS, IMPORT_LIMITS, parseGardenImport } from '../lib/import';
import type { Conversation, ImportResponse, StateResponse } from '../lib/types';

let seq = 0;
const mintId = (prefix: string) => `${prefix}_${(seq += 1)}`;

function conv(partial: Partial<Conversation> & { id: string; title: string }): Conversation {
  return { parentId: null, messages: [], insights: [], pinnedTier: null, archived: false, ...partial };
}

const routing = {
  tier: 'quick' as const,
  model: 'claude-haiku-5-5',
  effort: 'low' as const,
  effortNote: 'single pass',
  contextTokens: 120,
  estCostUsd: 0.0001,
  reason: 'A lookup the brief answers.',
  complexity: 1 as const,
  escalated: false,
  overridden: false,
};

const garden: Conversation[] = [
  conv({
    id: 'root',
    title: 'Trunk',
    messages: [
      { id: 'm1', role: 'user', content: 'Which club?' },
      { id: 'm2', role: 'assistant', content: 'Free Ventures.', routing },
    ],
    insights: [{ id: 'i1', branchId: 'b1', parentId: 'root', text: 'Apply by Sept 11.', createdAt: '2026-08-18T00:00:00.000Z' }],
  }),
  conv({
    id: 'b1',
    title: 'Deadline',
    parentId: 'root',
    brief: {
      id: 'brief-1',
      branchId: 'b1',
      selection: 'Free Ventures',
      markdown: '# Brief',
      facts: ['Free Ventures applications close September 11.'],
      excludedNote: 'Everything else.',
      availableTokens: 4000,
      briefTokens: 90,
      prunedPct: 97.8,
      anchorMessageId: 'm2',
    },
  }),
  conv({ id: 'b2', title: 'Deeper', parentId: 'b1' }),
];

const fileOf = (conversations: unknown[], format = 'bonsai-garden@1') => ({ format, conversations });

describe('parseGardenImport', () => {
  it('round-trips a Bonsai export with every id replaced and every link rewired', () => {
    const result = parseGardenImport(JSON.parse(exportJson(garden, { kind: 'garden' })), mintId);
    if (!result.ok) throw new Error(result.error);
    const [root, b1, b2] = result.conversations;
    const oldIds = new Set(['root', 'b1', 'b2', 'm1', 'm2', 'i1', 'brief-1']);
    for (const c of result.conversations) {
      expect(oldIds.has(c.id)).toBe(false);
      for (const m of c.messages) expect(oldIds.has(m.id)).toBe(false);
    }
    expect(root.parentId).toBeNull();
    expect(b1.parentId).toBe(root.id);
    expect(b2.parentId).toBe(b1.id);
    expect(b1.brief).toMatchObject({ branchId: b1.id, anchorMessageId: root.messages[1].id, prunedPct: 97.8 });
    expect(root.messages[1].routing).toMatchObject({ model: 'claude-haiku-5-5', reason: 'A lookup the brief answers.' });
  });

  it('treats the file as untrusted: marks briefs imported, drops insights and profiles', () => {
    const withProfile = [{ ...garden[0], profile: { name: 'Someone else', context: 'Not you.', goals: ['steer'] } }, ...garden.slice(1)];
    const result = parseGardenImport(fileOf(withProfile), mintId);
    if (!result.ok) throw new Error(result.error);
    const [root, b1] = result.conversations;
    expect(root.profile).toBeUndefined();
    expect(root.insights).toEqual([]);
    expect(result.insightsDropped).toBe(1);
    expect(b1.brief?.imported).toBe(true);
  });

  it('gives every message its own id when two conversations reuse one', () => {
    const shared = fileOf(
      [
        conv({ id: 'x', title: 'X', messages: [{ id: 'msg-dup', role: 'user', content: 'first tree' }] }),
        conv({
          id: 'y',
          title: 'Y',
          messages: [
            { id: 'msg-dup', role: 'user', content: 'second tree' },
            { id: 'msg-dup', role: 'assistant', content: 'repeat inside one tree' },
          ],
        }),
        conv({
          id: 'z',
          title: 'Z',
          parentId: 'y',
          brief: { ...garden[1].brief!, id: 'bz', branchId: 'z', anchorMessageId: 'msg-dup' },
        }),
      ],
      'espalier-garden@1',
    );
    const result = parseGardenImport(shared, mintId);
    if (!result.ok) throw new Error(result.error);
    const [x, y, z] = result.conversations;
    const ids = [...x.messages, ...y.messages].map((m) => m.id);
    expect(new Set(ids).size).toBe(3);
    // The anchor resolves inside the branch's own parent, to the first message with that id.
    expect(z.brief?.anchorMessageId).toBe(y.messages[0].id);
  });

  it('orders parents before children whatever order the file uses', () => {
    const shuffled = [garden[2], garden[1], garden[0]];
    const result = parseGardenImport(fileOf(shuffled), mintId);
    if (!result.ok) throw new Error(result.error);
    expect(result.conversations.map((c) => c.title)).toEqual(['Trunk', 'Deadline', 'Deeper']);
  });

  it('turns a single-branch export into a root', () => {
    const result = parseGardenImport(JSON.parse(exportJson(garden, { kind: 'branch', id: 'b1' })), mintId);
    if (!result.ok) throw new Error(result.error);
    expect(result.conversations[0].parentId).toBeNull();
    expect(result.conversations[0].brief?.anchorMessageId).toBeUndefined();
    expect(result.conversations[1].parentId).toBe(result.conversations[0].id);
  });

  it('accepts an Espalier export: epoch timestamps, Gemini pins and its own routing fields', () => {
    const espalier = fileOf(
      [
        {
          id: 'tree-a',
          title: 'Espalier root',
          parentId: null,
          createdAt: 1_758_000_000_000,
          messages: [
            {
              id: 'msg-a',
              role: 'assistant',
              content: 'Answer.',
              createdAt: 1_758_000_000_000,
              routing: { ...routing, model: 'gemini-flash', servedModelLabel: 'Flash', learningNote: 'n/a' },
            },
          ],
          insights: [],
          pinnedMode: { mode: 'manual', model: 'gemini-pro', effort: 'high' },
          archived: false,
        },
      ],
      'espalier-garden@1',
    );
    const result = parseGardenImport(espalier, mintId);
    if (!result.ok) throw new Error(result.error);
    const [root] = result.conversations;
    expect(root.pinnedMode).toBeNull();
    expect(root.messages[0].createdAt).toBe(new Date(1_758_000_000_000).toISOString());
    expect(root.messages[0].routing).not.toHaveProperty('servedModelLabel');
  });

  it('drops a malformed routing record instead of failing the file', () => {
    const result = parseGardenImport(
      fileOf([conv({ id: 'r', title: 'R', messages: [{ id: 'm', role: 'assistant', content: 'x', routing: { tier: 'huge' } as never }] })]),
      mintId,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.conversations[0].messages[0]).not.toHaveProperty('routing');
  });

  it.each([
    ['an unknown format', { format: 'chatgpt@1', conversations: [garden[0]] }, /format/],
    ['an empty garden', fileOf([]), /conversations/],
    ['a loop', fileOf([conv({ id: 'a', title: 'A', parentId: 'b' }), conv({ id: 'b', title: 'B', parentId: 'a' })]), /loop/],
    ['duplicate ids', fileOf([conv({ id: 'a', title: 'A' }), conv({ id: 'a', title: 'A again' })]), /share an id/],
    ['a bad role', fileOf([conv({ id: 'a', title: 'A', messages: [{ id: 'm', role: 'system' as never, content: 'x' }] })]), /role/],
    ['too many trees', fileOf(Array.from({ length: IMPORT_LIMITS.conversations + 1 }, (_, i) => conv({ id: `c${i}`, title: 'x' }))), /conversations/],
  ])('rejects %s', (_label, file, error) => {
    const result = parseGardenImport(file, mintId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(error);
  });

  it('caps the total message count across the file', () => {
    const many = Array.from({ length: 3 }, (_, i) =>
      conv({
        id: `c${i}`,
        title: 'x',
        messages: Array.from({ length: 400 }, (_, j) => ({ id: `m${i}-${j}`, role: 'user' as const, content: 'q' })),
      }),
    );
    const result = parseGardenImport(fileOf(many), mintId);
    expect(result.ok).toBe(false);
  });

  it('caps the total insight count across the file', () => {
    const insights = Array.from({ length: 100 }, (_, j) => ({ id: `i${j}`, branchId: 'x', parentId: 'x', text: 'one line', createdAt: '2026-10-01T00:00:00Z' }));
    const many = Array.from({ length: 4 }, (_, i) => conv({ id: `c${i}`, title: 'x', insights }));
    const result = parseGardenImport(fileOf(many), mintId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/insights/);
  });
});

describe('POST /api/import and DELETE /api/routing-profile', () => {
  let importRoute: (req: Request) => Promise<Response>;
  let stateRoute: (req: Request) => Promise<Response>;
  let forgetRoute: (req: Request) => Promise<Response>;
  let store: typeof import('../lib/store');
  let ipSeq = 0;
  const freshIp = () => `198.51.100.${(ipSeq += 1)}`;

  beforeAll(async () => {
    vi.stubEnv('DATABASE_URL', '');
    importRoute = (await import('../app/api/import/route')).POST;
    stateRoute = (await import('../app/api/state/route')).GET;
    forgetRoute = (await import('../app/api/routing-profile/route')).DELETE;
    store = await import('../lib/store');
  });

  const post = (body: string, opts: { cookie: string; ip?: string; type?: string }) =>
    importRoute(
      new Request('http://localhost/api/import', {
        method: 'POST',
        headers: {
          'content-type': opts.type ?? 'application/json',
          'x-forwarded-for': opts.ip ?? freshIp(),
          cookie: `bonsai_session=${opts.cookie}`,
        },
        body,
      }),
    );

  it('adds the file beside the existing garden without touching it', async () => {
    const cookie = `s_import_${Date.now()}`;
    const before = (await (
      await stateRoute(new Request('http://localhost/api/state', { headers: { cookie: `bonsai_session=${cookie}` } }))
    ).json()) as StateResponse;
    const res = await post(exportJson(garden, { kind: 'garden' }), { cookie });
    expect(res.status).toBe(200);
    const after = (await res.json()) as ImportResponse;
    expect(after.imported).toBe(3);
    expect(after.rootId).toBe(before.rootId);
    expect(after.conversations).toHaveLength(before.conversations.length + 3);
    for (const c of before.conversations) expect(after.conversations).toContainEqual(c);
    expect(after.tree.filter((n) => n.parentId === null)).toHaveLength(2);
  });

  it('refuses non-JSON bodies, oversized files and garbage with a reason', async () => {
    const cookie = `s_bad_${Date.now()}`;
    expect((await post('{}', { cookie, type: 'text/plain' })).status).toBe(415);
    // CORS-safelisted, so no preflight: the media type itself must be application/json.
    expect((await post('{}', { cookie, type: 'text/plain; x=application/json' })).status).toBe(415);
    expect((await post('x'.repeat(IMPORT_LIMITS.bytes + 1), { cookie })).status).toBe(413);
    // The cap is bytes, not UTF-16 units: this is under 2M characters but over 2 MB.
    expect((await post('é'.repeat(IMPORT_LIMITS.bytes / 2 + 1), { cookie })).status).toBe(413);
    const garbage = await post('not json', { cookie });
    expect(garbage.status).toBe(400);
    expect(((await garbage.json()) as { error: string }).error).toMatch(/JSON/);
    expect((await post('{"format":"bonsai-garden@1","conversations":[]}', { cookie })).status).toBe(400);
  });

  it('accepts a JSON content type with parameters', async () => {
    const res = await post(exportJson(garden, { kind: 'garden' }), {
      cookie: `s_charset_${Date.now()}`,
      type: 'application/json; charset=utf-8',
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ImportResponse).insightsDropped).toBe(1);
  });

  it('stops importing once a garden is full', async () => {
    const cookie = `s_full_${Date.now()}`;
    const file = fileOf(Array.from({ length: IMPORT_LIMITS.conversations }, (_, i) => conv({ id: `c${i}`, title: 'x' })));
    const statuses: number[] = [];
    for (let i = 0; i < GARDEN_LIMITS.conversations / IMPORT_LIMITS.conversations; i += 1) {
      statuses.push((await post(JSON.stringify(file), { cookie })).status);
    }
    // The session root plus five full files would pass the cap, so the fifth is refused.
    expect(statuses).toEqual([200, 200, 200, 200, 413]);
  });

  it('limits imports per network', async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await post('{}', { cookie: `s_rl_${i}`, ip })).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('forgets only this session’s routing profile', async () => {
    const mine = `s_forget_${Date.now()}`;
    const theirs = `s_keep_${Date.now()}`;
    const event = { kind: 'override' as const, classifiedTier: 'quick' as const, chosenTier: 'deep' as const, questionKind: 'lookup' as const };
    await store.recordRoutingFeedback(mine, event);
    await store.recordRoutingFeedback(theirs, event);
    const res = await forgetRoute(
      new Request('http://localhost/api/routing-profile', { method: 'DELETE', headers: { cookie: `bonsai_session=${mine}` } }),
    );
    expect(res.status).toBe(200);
    expect(await store.loadProfile(mine)).toEqual((await import('bonsai-engine')).emptyProfile());
    expect(await store.loadProfile(theirs)).not.toEqual((await import('bonsai-engine')).emptyProfile());
  });
});
