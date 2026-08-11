import { promises as fs } from 'fs';
import path from 'path';
import type { InferenceLog } from './types';

const LOCAL_PATH = path.join(process.cwd(), 'data', 'inference-log.json');

async function readLocalLogs(): Promise<InferenceLog[]> {
  try {
    return JSON.parse(await fs.readFile(LOCAL_PATH, 'utf8')) as InferenceLog[];
  } catch {
    return [];
  }
}

export async function appendInferenceLogs(logs: InferenceLog[]): Promise<void> {
  if (!logs.length) return;
  try {
    const existing = await readLocalLogs();
    const seen = new Set(existing.map((l) => l.id));
    const merged = [...existing, ...logs.filter((l) => !seen.has(l.id))];
    await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
    await fs.writeFile(LOCAL_PATH, JSON.stringify(merged, null, 2));
  } catch {
    // Vercel's filesystem is read-only outside /tmp; losing the local mirror is survivable.
  }
}
