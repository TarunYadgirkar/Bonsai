'use client';

import { useState } from 'react';

interface ConnectResponse {
  key: string;
  url: string;
  mode: 'neon' | 'memory';
}

/** The mint-my-link interaction on /connect. One key per browser session; repeat clicks reuse it. */
function RevokeControl() {
  const [state, setState] = useState<'idle' | 'busy' | number>('idle');
  const revoke = async () => {
    setState('busy');
    try {
      const res = await fetch('/api/oauth/revoke', { method: 'POST' });
      const body = (await res.json()) as { revoked?: number };
      setState(res.ok ? (body.revoked ?? 0) : 'idle');
    } catch {
      setState('idle');
    }
  };
  return (
    <div className="mt-3 border-t border-rule pt-3">
      <button onClick={revoke} disabled={state === 'busy'} className="text-[11px] text-bark underline hover:text-ember disabled:opacity-40">
        {state === 'busy' ? 'Revoking…' : 'Revoke connector access'}
      </button>
      {typeof state === 'number' && (
        <span className="ml-2 text-[11px] text-moss">
          {state} OAuth {state === 1 ? 'grant' : 'grants'} revoked — reconnect in claude.ai to
          reauthorize.
        </span>
      )}
    </div>
  );
}

export function ConnectCard() {
  const [result, setResult] = useState<ConnectResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/connect', { method: 'POST' });
      const body = (await res.json()) as ConnectResponse & { error?: string };
      if (!res.ok) throw new Error(body.error || `POST /api/connect → ${res.status}`);
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    if (!result) return;
    navigator.clipboard?.writeText(result.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="mt-6 rounded-xl border border-rule bg-paper-raised p-5">
      {result ? (
        <div>
          <p className="eyebrow">your connector link</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-rule bg-paper-sunk px-3 py-2 font-mono text-[12px] text-ink">
              {result.url}
            </code>
            <button
              onClick={copy}
              className="shrink-0 rounded-lg bg-moss px-3 py-2 text-xs font-medium text-paper transition-colors hover:bg-moss-bright"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {result.mode === 'memory' && (
            <p className="mt-2 text-[11px] text-ember">
              This deployment has no database — the link uses the shared dev key and the garden
              will not persist. Fine for trying it out, not for keeps.
            </p>
          )}
          <p className="mt-2 text-[11px] text-bark">
            Same browser, same link — coming back here returns this key rather than minting
            another.
          </p>
          <RevokeControl />
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <button
            onClick={create}
            disabled={busy}
            className="rounded-lg bg-moss px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-moss-bright disabled:opacity-40"
          >
            {busy ? 'Growing your key…' : 'Create my connector link'}
          </button>
          <p className="text-[11px] text-bark">
            Free, no account — the link itself is the credential.
          </p>
          {error && <p className="text-[11px] text-ember">{error}</p>}
        </div>
      )}
    </div>
  );
}
