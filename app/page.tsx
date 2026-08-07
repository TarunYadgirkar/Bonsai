import seed from "@/fixtures/seed-conversation.json";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-5xl font-semibold tracking-tight">Bonsai</h1>
      <p className="text-sm opacity-60">
        Grow conversations as trees. Prune context automatically.
      </p>
      <p className="mt-6 text-lg">{seed.title}</p>
      <p className="text-sm opacity-60">
        {seed.messages.length} messages · seeded from fixtures
      </p>
    </main>
  );
}
