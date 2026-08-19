import type { Metadata } from 'next';
import { ConnectCard } from '@/components/ConnectCard';

export const metadata: Metadata = {
  title: 'Attach Bonsai to claude.ai',
  description:
    'Get your personal Bonsai connector link: fork side-questions with compiled minimal briefs, merge distilled insights back, and see your garden inline in claude.ai.',
};

export default function ConnectPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-paper px-6 py-14">
      <div className="w-full max-w-xl">
        <p className="eyebrow">bonsai × claude.ai</p>
        <h1 className="mt-1 font-display text-3xl text-ink">Attach Bonsai to claude.ai</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Bonsai gives any claude.ai conversation a fork/merge loop: branch a side-question off
          with a <span className="text-ink">compiled minimal brief</span> instead of the whole
          history, answer it in a fresh chat, and merge <span className="text-ink">one distilled
          insight</span> back. Your garden renders inline as an interactive tree.
        </p>

        <div className="mt-6 rounded-xl border border-moss/40 bg-moss-wash/40 p-5">
          <p className="eyebrow">the easy way — oauth</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            In claude.ai: Settings → Connectors → <span className="text-ink">Add custom
            connector</span> → paste
          </p>
          <code className="mt-2 block overflow-x-auto whitespace-nowrap rounded-lg border border-rule bg-paper-sunk px-3 py-2 font-mono text-[12px] text-ink">
            https://bonsai-connector.vercel.app/api/mcp
          </code>
          <p className="mt-2 text-[11px] text-bark">
            claude.ai walks you through a one-click approval — no keys to copy, and the grant
            maps to the same garden model below.
          </p>
        </div>

        <p className="mt-6 eyebrow">or: a key link (no oauth, works everywhere)</p>
        <ConnectCard />

        <ol className="mt-8 flex flex-col gap-3 text-sm leading-relaxed text-ink-soft">
          <li>
            <span className="font-medium text-ink">1 · Create your connector link above.</span>{' '}
            The key in the URL is your garden — treat the link like a password.
          </li>
          <li>
            <span className="font-medium text-ink">2 · In claude.ai:</span> Settings → Connectors
            → <span className="text-ink">Add custom connector</span> → paste the link. No sign-in
            step — the key is the credential.
          </li>
          <li>
            <span className="font-medium text-ink">3 · In any chat:</span> say{' '}
            <span className="rounded bg-paper-sunk px-1.5 py-0.5 font-mono text-[12px]">
              fork this side question with Bonsai
            </span>{' '}
            — Claude compiles the brief and hands you a paste-ready branch. Say{' '}
            <span className="rounded bg-paper-sunk px-1.5 py-0.5 font-mono text-[12px]">
              show my bonsai tree
            </span>{' '}
            to see the garden inline.
          </li>
        </ol>

        <p className="mt-8 border-t border-rule pt-4 text-[11px] leading-relaxed text-bark">
          Honesty notes: your branches and insights are stored against your key so the tree
          survives across chats; the key is high-entropy and unlisted, but anyone holding the
          full link can read that garden — regenerating a key is not self-serve yet. The{' '}
          <a href="/" className="underline hover:text-ink-soft">
            web demo
          </a>{' '}
          is a separate playground and does not share data with your connector garden.
        </p>
      </div>
    </main>
  );
}
