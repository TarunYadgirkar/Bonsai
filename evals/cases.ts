/**
 * Eval scenarios. Each case builds a conversation state in-process, forks it, and asserts on
 * the compiled brief, the routing decision, or the distilled insight.
 *
 * The referent-resolution cases are the moat: a branch question with a dangling referent
 * ("when do apps close?") must yield a brief containing the resolved entity, at depth 1 AND
 * depth 2 — full-copy branching products don't have this problem, so Bonsai must prove it
 * doesn't either. Assertions are entity-presence checks, so they hold for the extractive mock
 * and for live models alike.
 */
import type { Conversation, Message, UserProfile } from '@bonsai/engine';

let seq = 0;
export function msg(role: 'user' | 'assistant', content: string): Message {
  seq += 1;
  return { id: `eval_msg_${seq}`, role, content };
}

export function conv(params: {
  id: string;
  title: string;
  parentId?: string | null;
  profile?: UserProfile;
  messages: Message[];
  brief?: Conversation['brief'];
  insights?: Conversation['insights'];
}): Conversation {
  return {
    id: params.id,
    title: params.title,
    parentId: params.parentId ?? null,
    ...(params.profile ? { profile: params.profile } : {}),
    messages: params.messages,
    ...(params.brief ? { brief: params.brief } : {}),
    insights: params.insights ?? [],
    pinnedTier: null,
    archived: false,
  };
}

/* ---------- scenario: Berkeley clubs (mirrors the demo fixture's shape) ---------- */

export const clubsProfile: UserProfile = {
  name: 'Tarun',
  context: 'Incoming Berkeley freshman in applied math, CS-focused, building a startup.',
  goals: ['join at most two clubs', 'builder-first over resume-padding'],
};

export const clubsRoot = conv({
  id: 'eval_clubs_root',
  title: 'Berkeley clubs research',
  profile: clubsProfile,
  messages: [
    msg('user', 'I am figuring out which Berkeley clubs to join this fall.'),
    msg(
      'assistant',
      'Worth a look: Free Ventures is a student-run startup accelerator where you apply with your own company. ML@B is the machine learning club with a heavy education track. Blueprint builds software for nonprofits.',
    ),
    msg('user', 'What is the Free Ventures timeline?'),
    msg(
      'assistant',
      'Free Ventures applications close September 11, with an info session on September 3. That gives eight days between the session and the deadline.',
    ),
    msg('user', 'And time commitments?'),
    msg(
      'assistant',
      'ML@B runs 12-14 hours weekly in the first semester once the education track is counted. Blueprint fits in 6-8 hours weekly. Free Ventures overhead is roughly 3-4 hours weekly on top of your own startup work.',
    ),
  ],
});

/* ---------- scenario: apartment hunt (no overlap with the demo fixture) ---------- */

export const apartmentRoot = conv({
  id: 'eval_apt_root',
  title: 'SF apartment hunt',
  messages: [
    msg('user', 'Help me pick between the two apartments I toured this week.'),    msg(
      'assistant',
      'Recapping your notes: the Dolores Heights one-bedroom is $3,400 a month, top floor, no laundry in unit, landlord wants a 14-month lease. The Inner Richmond junior one-bedroom is $2,750, ground floor, in-unit laundry, month-to-month after the first year.',
    ),
    msg('user', 'My commute matters most — I work in Mission Bay three days a week.'),
    msg(
      'assistant',
      'From Dolores Heights the J line gets you to Mission Bay in about 25 minutes door to door. From the Inner Richmond you are looking at 45-55 minutes with a transfer, or a long 5R ride.',
    ),
  ],
});

/* ---------- scenario: PhD funding (common-word noise around one rare-term answer) ---------- */

export const fundingRoot = conv({
  id: 'eval_fund_root',
  title: 'PhD program funding',
  messages: [
    msg('user', 'Help me compare the funding packages across the PhD programs I got into.'),
    msg(
      'assistant',
      'All three programs offer full tuition remission. The Stanford and MIT programs offer standard teaching assistantships. Both programs offer subsidized housing for the first year. The Berkeley package includes the Hertz fellowship, which pays a stipend of 55,000 dollars per year.',
    ),
    msg('user', 'Which programs offer the best conference travel support?'),
    msg(
      'assistant',
      'The MIT and Stanford programs offer 1,500 dollars of conference travel each year.',
    ),
  ],
});

/* ---------- case definitions ---------- */

export interface BriefCase {
  kind: 'brief';
  name: string;
  parent: Conversation;
  ancestors?: Conversation[];
  selection: string;
  question: string;
  /** Every entry must appear (case-insensitive) somewhere in the compiled brief's markdown. */
  mustContain: string[];
}

export interface RouteCase {
  kind: 'route';
  name: string;
  question: string;
  briefFacts: string[];
  expectTier: 'quick' | 'thoughtful' | 'deep';
  expectCovered?: boolean;
}

export interface DistillCase {
  kind: 'distill';
  name: string;
  branch: Conversation;
  mustContain: string[];
  maxWords: number;
}

export type EvalCase = BriefCase | RouteCase | DistillCase;

export const CASES: EvalCase[] = [
  {
    kind: 'brief',
    name: 'depth-1 referent: "apps" resolves to Free Ventures',
    parent: clubsRoot,
    selection: 'Free Ventures',
    question: 'when do apps close?',
    mustContain: ['Free Ventures', 'September 11'],
  },
  {
    kind: 'brief',
    name: 'depth-1 referent: "the cheaper one" resolves to Inner Richmond',
    parent: apartmentRoot,
    selection: 'Inner Richmond junior one-bedroom',
    question: 'what is the commute from the cheaper one?',
    mustContain: ['Inner Richmond'],
  },
  {
    kind: 'brief',
    name: 'salience: rare-term stipend sentence survives common-word noise',
    parent: fundingRoot,
    selection: 'stipend amounts',
    question: 'how large is the stipend the programs offer?',
    mustContain: ['Hertz', '55,000'],
  },
  {
    kind: 'route',
    name: 'lookup routes quick',
    question: 'When do Free Ventures applications close?',
    briefFacts: ['Free Ventures applications close September 11, info session September 3.'],
    expectTier: 'quick',
    expectCovered: true,
  },
  {
    kind: 'route',
    name: 'multi-constraint ranking routes deep',
    question:
      'Given my goals, workload cap, and everything we know, rank the top 3 clubs and explain the opportunity cost of each.',
    briefFacts: ['Free Ventures applications close September 11.'],
    expectTier: 'deep',
  },
  {
    kind: 'route',
    name: 'uncovered question is flagged',
    question: 'What is the ML@B interview process like?',
    briefFacts: ['The Dolores Heights one-bedroom costs $3,400 a month.'],
    expectTier: 'quick',
    expectCovered: false,
  },
  {
    kind: 'distill',
    name: 'merge distills one referent-resolved line',
    branch: conv({
      id: 'eval_distill_branch',
      title: 'Free Ventures deadline',
      parentId: 'eval_clubs_root',
      messages: [
        msg('user', 'when do apps close?'),
        msg(
          'assistant',
          'Free Ventures applications close September 11, with an info session on September 3.',
        ),
      ],
      brief: {
        id: 'eval_brief_d',
        branchId: 'eval_distill_branch',
        selection: 'Free Ventures',
        markdown: '# Branch brief — Free Ventures',
        facts: ['Free Ventures applications close September 11.'],
        excludedNote: 'Excluded: everything else.',
        availableTokens: 500,
        briefTokens: 40,
        prunedPct: 92,
      },
    }),
    mustContain: ['Free Ventures'],
    maxWords: 22,
  },
];
