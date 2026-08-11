import { randomUUID } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  readdir,
  rename,
  unlink,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const READ_DIRECTORY_FLAGS =
  fileConstants.O_RDONLY | fileConstants.O_DIRECTORY | fileConstants.O_NOFOLLOW;

export interface AtomicFileSystem {
  link: typeof link;
  lstat: typeof lstat;
  mkdir: typeof mkdir;
  open: typeof open;
  opendir: typeof opendir;
  readdir: typeof readdir;
  rename: typeof rename;
  unlink: typeof unlink;
}

export const nodeAtomicFileSystem: AtomicFileSystem = {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  readdir,
  rename,
  unlink,
};

export class AtomicDestinationExistsError extends Error {
  constructor(path: string) {
    super(`atomic destination already exists: ${basename(path)}`);
    this.name = 'AtomicDestinationExistsError';
  }
}

export class AtomicFileTooLargeError extends Error {
  constructor(path: string) {
    super(`persistence file is too large: ${basename(path)}`);
    this.name = 'AtomicFileTooLargeError';
  }
}

export class AtomicFileTruncatedError extends Error {
  constructor(path: string) {
    super(`persistence file is truncated: ${basename(path)}`);
    this.name = 'AtomicFileTruncatedError';
  }
}

export class AtomicDirectoryTooLargeError extends Error {
  constructor(path: string) {
    super(`persistence directory has too many entries: ${basename(path)}`);
    this.name = 'AtomicDirectoryTooLargeError';
  }
}

export class AtomicUnsafePathError extends Error {
  constructor(path: string) {
    super(`persistence path is unsafe: ${basename(path)}`);
    this.name = 'AtomicUnsafePathError';
  }
}

export interface FileIdentity {
  dev: number;
  ino: number;
  mode: number;
  mtimeMs: number;
  nlink: number;
  size: number;
  uid: number;
}

export interface BoundedFile {
  bytes: Buffer;
  identity: FileIdentity;
}

export async function ensurePrivateDirectory(
  fileSystem: AtomicFileSystem,
  path: string,
): Promise<void> {
  await fileSystem.mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const handle = await openDirectoryNoFollow(fileSystem, path, false);
  try {
    await handle.chmod(PRIVATE_DIRECTORY_MODE);
  } finally {
    await handle.close();
  }
}

export async function assertDirectoryNoFollow(
  fileSystem: AtomicFileSystem,
  path: string,
  requirePrivate = true,
): Promise<void> {
  const handle = await openDirectoryNoFollow(fileSystem, path, requirePrivate);
  await handle.close();
}

export async function listDirectoryNoFollow(
  fileSystem: AtomicFileSystem,
  path: string,
  requirePrivate = true,
  maximumEntries = Number.MAX_SAFE_INTEGER,
): Promise<string[]> {
  await assertDirectoryNoFollow(fileSystem, path, requirePrivate);
  const directory = await fileSystem.opendir(path);
  const entries: string[] = [];
  try {
    for (;;) {
      const entry = await directory.read();
      if (!entry) return entries;
      if (entries.length === maximumEntries) {
        throw new AtomicDirectoryTooLargeError(path);
      }
      entries.push(entry.name);
    }
  } finally {
    await directory.close().catch((error: unknown) => {
      if (!isDirectoryAlreadyClosed(error)) throw error;
    });
  }
}

export async function writeAtomicFile(
  fileSystem: AtomicFileSystem,
  destination: string,
  data: string | Uint8Array,
  options: { overwrite: boolean },
): Promise<void> {
  const temporaryPath = await writeSyncedTemporaryFile(fileSystem, destination, data);
  let temporaryExists = true;
  try {
    if (options.overwrite) {
      await fileSystem.rename(temporaryPath, destination);
    } else {
      try {
        await fileSystem.link(temporaryPath, destination);
      } catch (error: unknown) {
        if (isAlreadyExists(error)) throw new AtomicDestinationExistsError(destination);
        throw error;
      }
      await fileSystem.unlink(temporaryPath);
    }
    temporaryExists = false;
  } finally {
    if (temporaryExists) await unlinkIfPresent(fileSystem, temporaryPath);
  }
}

export async function writeSyncedTemporaryFile(
  fileSystem: AtomicFileSystem,
  destination: string,
  data: string | Uint8Array,
): Promise<string> {
  const temporaryPath = join(
    dirname(destination),
    `.${basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: FileHandle | undefined;
  try {
    handle = await openRegularFileNoFollow(
      fileSystem,
      temporaryPath,
      fileConstants.O_WRONLY |
        fileConstants.O_CREAT |
        fileConstants.O_EXCL |
        fileConstants.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    await handle.chmod(PRIVATE_FILE_MODE);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    return temporaryPath;
  } catch (error: unknown) {
    if (handle) await handle.close().catch(() => undefined);
    await unlinkIfPresent(fileSystem, temporaryPath);
    throw error;
  }
}

export async function syncDirectory(
  fileSystem: AtomicFileSystem,
  path: string,
): Promise<void> {
  const handle = await openDirectoryNoFollow(fileSystem, path, true);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function truncateFileDurably(
  fileSystem: AtomicFileSystem,
  path: string,
  length: number,
): Promise<void> {
  const handle = await openRegularFileNoFollow(
    fileSystem,
    path,
    fileConstants.O_RDWR | fileConstants.O_CREAT | fileConstants.O_NOFOLLOW,
    PRIVATE_FILE_MODE,
  );
  try {
    await handle.chmod(PRIVATE_FILE_MODE);
    const current = await handle.stat();
    if (current.size < length) throw new AtomicFileTruncatedError(path);
    await handle.truncate(length);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function appendFileDurably(
  fileSystem: AtomicFileSystem,
  path: string,
  records: Iterable<Uint8Array>,
): Promise<void> {
  const iterator = records[Symbol.iterator]();
  const first = iterator.next();
  if (first.done) return;
  const handle = await openRegularFileNoFollow(
    fileSystem,
    path,
    fileConstants.O_WRONLY |
      fileConstants.O_APPEND |
      fileConstants.O_CREAT |
      fileConstants.O_NOFOLLOW,
    PRIVATE_FILE_MODE,
  );
  try {
    await handle.chmod(PRIVATE_FILE_MODE);
    await handle.writeFile(first.value);
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      await handle.writeFile(next.value);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function readBoundedFile(
  fileSystem: AtomicFileSystem,
  path: string,
  maximumBytes: number,
): Promise<Buffer> {
  return (await readBoundedFileWithIdentity(fileSystem, path, maximumBytes)).bytes;
}

export async function readBoundedFileWithIdentity(
  fileSystem: AtomicFileSystem,
  path: string,
  maximumBytes: number,
): Promise<BoundedFile> {
  const handle = await openRegularFileNoFollow(
    fileSystem,
    path,
    fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW,
  );
  try {
    const file = await handle.stat();
    if (!Number.isSafeInteger(file.size) || file.size > maximumBytes) {
      throw new AtomicFileTooLargeError(path);
    }
    return {
      bytes: await readExact(handle, path, 0, file.size),
      identity: fileIdentity(file),
    };
  } finally {
    await handle.close();
  }
}

export async function unlinkFileIfIdentity(
  fileSystem: AtomicFileSystem,
  path: string,
  expected: FileIdentity,
): Promise<boolean> {
  let entry;
  try {
    entry = await fileSystem.lstat(path);
  } catch (error: unknown) {
    if (isNotFound(error)) return false;
    throw error;
  }
  if (
    !entry.isFile() ||
    entry.isSymbolicLink() ||
    entry.nlink !== 1 ||
    entry.dev !== expected.dev ||
    entry.ino !== expected.ino ||
    entry.mode !== expected.mode ||
    entry.mtimeMs !== expected.mtimeMs ||
    entry.size !== expected.size ||
    entry.uid !== expected.uid
  ) {
    return false;
  }
  await fileSystem.unlink(path);
  return true;
}

export async function inspectPrivateRegularFile(
  fileSystem: AtomicFileSystem,
  path: string,
): Promise<FileIdentity | null> {
  const entry = await fileSystem.lstat(path);
  const currentUid = process.getuid?.();
  if (
    entry.isSymbolicLink() ||
    !entry.isFile() ||
    entry.nlink !== 1 ||
    (entry.mode & 0o077) !== 0 ||
    (currentUid !== undefined && entry.uid !== currentUid)
  ) {
    return null;
  }
  return fileIdentity(entry);
}

export async function visitFileRange(
  fileSystem: AtomicFileSystem,
  path: string,
  start: number,
  length: number,
  chunkBytes: number,
  visit: (chunk: Buffer) => void | Promise<void>,
): Promise<void> {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    !Number.isSafeInteger(start + length) ||
    !Number.isSafeInteger(chunkBytes) ||
    chunkBytes <= 0
  ) {
    throw new AtomicFileTooLargeError(path);
  }
  const handle = await openRegularFileNoFollow(
    fileSystem,
    path,
    fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW,
  );
  try {
    const file = await handle.stat();
    if (file.size < start + length) throw new AtomicFileTruncatedError(path);
    let offset = 0;
    while (offset < length) {
      const requested = Math.min(chunkBytes, length - offset);
      const chunk = await readExact(handle, path, start + offset, requested);
      await visit(chunk);
      offset += requested;
    }
  } finally {
    await handle.close();
  }
}

export async function unlinkIfPresent(
  fileSystem: AtomicFileSystem,
  path: string,
): Promise<void> {
  try {
    await fileSystem.unlink(path);
  } catch (error: unknown) {
    if (!isNotFound(error)) throw error;
  }
}

export function isNotFound(error: unknown): boolean {
  return isNodeError(error) && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return isNodeError(error) && error.code === 'EEXIST';
}

function isDirectoryAlreadyClosed(error: unknown): boolean {
  return isNodeError(error) && error.code === 'ERR_DIR_CLOSED';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function openDirectoryNoFollow(
  fileSystem: AtomicFileSystem,
  path: string,
  requirePrivate: boolean,
): Promise<FileHandle> {
  const entry = await fileSystem.lstat(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new AtomicUnsafePathError(path);
  const handle = await fileSystem.open(path, READ_DIRECTORY_FLAGS);
  try {
    const opened = await handle.stat();
    const currentUid = process.getuid?.();
    if (
      !opened.isDirectory() ||
      (currentUid !== undefined && opened.uid !== currentUid) ||
      (requirePrivate && (opened.mode & 0o077) !== 0)
    ) {
      throw new AtomicUnsafePathError(path);
    }
    return handle;
  } catch (error: unknown) {
    await handle.close();
    throw error;
  }
}

async function openRegularFileNoFollow(
  fileSystem: AtomicFileSystem,
  path: string,
  flags: number,
  mode?: number,
): Promise<FileHandle> {
  const handle = await fileSystem.open(path, flags, mode);
  try {
    const opened = await handle.stat();
    const currentUid = process.getuid?.();
    const mutating = (flags & (fileConstants.O_WRONLY | fileConstants.O_RDWR)) !== 0;
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      (currentUid !== undefined && opened.uid !== currentUid) ||
      (!mutating && (opened.mode & 0o077) !== 0)
    ) {
      throw new AtomicUnsafePathError(path);
    }
    return handle;
  } catch (error: unknown) {
    await handle.close();
    throw error;
  }
}

function fileIdentity(file: Awaited<ReturnType<FileHandle['stat']>>): FileIdentity {
  return {
    dev: Number(file.dev),
    ino: Number(file.ino),
    mode: Number(file.mode),
    mtimeMs: Number(file.mtimeMs),
    nlink: Number(file.nlink),
    size: Number(file.size),
    uid: Number(file.uid),
  };
}

async function readExact(
  handle: FileHandle,
  path: string,
  position: number,
  length: number,
): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(bytes, offset, length - offset, position + offset);
    if (result.bytesRead === 0) throw new AtomicFileTruncatedError(path);
    offset += result.bytesRead;
  }
  return bytes;
}
