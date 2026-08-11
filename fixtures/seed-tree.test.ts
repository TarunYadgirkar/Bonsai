import { describe, expect, it } from 'vitest';
import { estimateTokens } from '@/lib/tokens';
import packageJson from '../package.json';
import tree from './seed-tree.json';

describe('generated seed tree contract', () => {
  it('pins the supported server to non-production root-only mode', () => {
    expect(packageJson.scripts['fixture:serve']).toMatch(/^NODE_ENV=development\b/);
    expect(packageJson.scripts['fixture:serve']).toContain('BONSAI_ROOT_ONLY_FIXTURE=1');
  });

  it('contains the six scenarios and eighteen inference events in exact purpose order', () => {
    expect(tree.branches.map((branch) => branch.title)).toEqual([
      'Free Ventures club inquiry',
      'ML@B club workload inquiry',
      'Top 3 clubs ranking inquiry',
      'Codebase club inquiry',
      'Blueprint club inquiry',
      'Law school tuition inquiry (off-brief)',
    ]);
    expect(tree.logs).toHaveLength(18);
    expect(tree.seq).toBe(44);
    expect(
      tree.logs.reduce<Record<string, number>>(
        (counts, log) => ({ ...counts, [log.purpose]: (counts[log.purpose] ?? 0) + 1 }),
        {},
      ),
    ).toEqual({ compile: 6, classify: 5, chat: 7 });
    expect(tree.logs.map((log) => log.purpose)).toEqual([
      'compile',
      'classify',
      'chat',
      'compile',
      'classify',
      'chat',
      'compile',
      'classify',
      'chat',
      'compile',
      'classify',
      'chat',
      'classify',
      'chat',
      'compile',
      'chat',
      'compile',
      'chat',
    ]);
  });

  it('has unique persisted IDs and traceable aligned brief provenance', () => {
    const ids = [
      ...tree.branches.flatMap((branch) => [
        branch.id,
        branch.brief?.id,
        ...branch.messages.map((message) => message.id),
        ...(branch.insights as Array<{ id: string }>).map((insight) => insight.id),
      ]),
      ...tree.logs.map((log) => log.id),
    ].filter((id): id is string => typeof id === 'string');

    expect(new Set(ids).size).toBe(ids.length);
    for (const branch of tree.branches) {
      if (!branch.brief) continue;
      const knownSourceIds = new Set(branch.brief.sourceRefs.map((source) => source.sourceId));
      expect(branch.brief.factSourceIds).toHaveLength(branch.brief.facts.length);
      expect(branch.brief.factProvenance).toHaveLength(branch.brief.facts.length);
      expect(
        branch.brief.factProvenance.every(
          (status) => status === 'model-cited' || status === 'extractive',
        ),
      ).toBe(true);
      for (const sourceIds of branch.brief.factSourceIds) {
        expect(sourceIds.length).toBeGreaterThan(0);
        expect(sourceIds.every((sourceId) => knownSourceIds.has(sourceId))).toBe(true);
      }
    }
  });

  it('uses zero counterfactual baseline for internal calls and persists manual override', () => {
    for (const log of tree.logs.filter((entry) => entry.purpose !== 'chat')) {
      expect(log.baselineInputTokens).toBe(0);
      expect(log.baselineCostUsd).toBe(0);
    }
    expect(
      tree.logs.every((log) => (log.baselineInputTokens === 0) === (log.baselineCostUsd === 0)),
    ).toBe(true);

    const manualBranch = tree.branches.find((branch) => branch.title.includes('Blueprint'));
    expect(manualBranch?.messages.at(-1)?.routing?.overridden).toBe(true);
    expect(
      tree.logs.some(
        (log) => log.branchId === manualBranch?.id && log.purpose === 'chat' && log.overridden,
      ),
    ).toBe(true);
  });

  it('keeps query text out of facts and includes each initial question in its answer baseline', () => {
    for (const branch of tree.branches) {
      const initialQuestion = branch.messages.find((message) => message.role === 'user')?.content;
      const initialAnswerLog = tree.logs.find(
        (log) => log.branchId === branch.id && log.purpose === 'chat',
      );
      expect(initialQuestion).toBeTruthy();
      expect(initialAnswerLog?.baselineInputTokens).toBe(
        branch.brief.availableTokens + estimateTokens(initialQuestion ?? ''),
      );
      expect(
        branch.brief.facts.every(
          (fact) =>
            !fact.endsWith('?') &&
            !/^(?:what|when|where|why|which|how|given .*\b(?:rank|compare|explain|list|recommend)\b)/i.test(
              fact,
            ),
        ),
      ).toBe(true);
    }
  });
});
