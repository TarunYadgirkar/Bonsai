import { hasKvConfiguration } from '../kv';
import { PersistenceConfigurationError } from './errors';
import { FilePersistenceBackend } from './file';
import { KvPersistenceBackend } from './kv';
import { MemoryPersistenceBackend } from './memory';
import type { PersistenceBackend } from './types';

type Environment = Readonly<Record<string, string | undefined>>;

export interface SelectPersistenceOptions {
  env?: Environment;
  cwd?: string;
}

export function selectPersistenceBackend(
  options: SelectPersistenceOptions = {},
): PersistenceBackend {
  const env = options.env ?? process.env;
  const explicit = env.BONSAI_PERSISTENCE_BACKEND;
  if (env.NODE_ENV === 'test') return new MemoryPersistenceBackend();
  if (env.NODE_ENV !== 'production' && env.BONSAI_ROOT_ONLY_FIXTURE === '1') {
    return new MemoryPersistenceBackend();
  }
  if (explicit !== undefined && explicit !== 'memory' && explicit !== 'kv' && explicit !== 'file') {
    throw new PersistenceConfigurationError('BONSAI_PERSISTENCE_BACKEND is invalid');
  }
  if (explicit === 'memory') {
    if (env.NODE_ENV === 'production') {
      throw new PersistenceConfigurationError('memory persistence is unavailable in production');
    }
    return new MemoryPersistenceBackend();
  }
  if (env.VERCEL || explicit === 'kv') {
    if (!hasKvConfiguration(env)) {
      throw new PersistenceConfigurationError('KV persistence is not configured');
    }
    return new KvPersistenceBackend({ env });
  }
  return new FilePersistenceBackend({ env, cwd: options.cwd });
}
