import { constants, createReadStream, createWriteStream, open as openFd, fstat as fstatFd, close as closeFd } from "node:fs";
import { mkdir, lstat, realpath, rename, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { StorageProvider, StorageStat, StorageWriteResult } from "./provider";
import { StorageObjectNotFoundError, StorageUnavailableError } from "./provider";

const STORAGE_KEY = /^[a-f0-9]{64}$/;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

function openDescriptor(filePath: string, flags: number, mode?: number) {
  return new Promise<number>((resolve, reject) => {
    if (mode === undefined) openFd(filePath, flags, (error, fd) => error ? reject(error) : resolve(fd));
    else openFd(filePath, flags, mode, (error, fd) => error ? reject(error) : resolve(fd));
  });
}

function descriptorStat(fd: number) {
  return new Promise<Awaited<ReturnType<typeof lstat>>>((resolve, reject) => {
    fstatFd(fd, (error, info) => error ? reject(error) : resolve(info));
  });
}

function closeDescriptor(fd: number) {
  return new Promise<void>((resolve) => closeFd(fd, () => resolve()));
}

function ensureKey(storageKey: string) {
  if (!STORAGE_KEY.test(storageKey)) throw new Error("Invalid opaque storage key");
}

function samePath(left: string, right: string) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function inside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export class LocalFilesystemStorage implements StorageProvider {
  private readonly root: string;
  private readonly objects: string;
  private readonly staging: string;
  private ready?: Promise<void>;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.objects = path.join(this.root, "objects");
    this.staging = path.join(this.root, ".staging");
  }

  private initialize() {
    this.ready ??= this.ensureDirectories().catch((error) => {
      this.ready = undefined;
      throw error instanceof StorageUnavailableError ? error : new StorageUnavailableError(undefined, { cause: error });
    });
    return this.ready;
  }

  private async ensureDirectories() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const rootStat = await lstat(this.root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("Storage root must be a real directory");
    const canonicalRoot = await realpath(this.root);
    if (!samePath(canonicalRoot, this.root)) throw new Error("Storage root cannot contain symlink path components");
    for (const directory of [this.objects, this.staging]) {
      await mkdir(directory, { recursive: false, mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      const info = await lstat(directory);
      if (info.isSymbolicLink() || !info.isDirectory() || !inside(canonicalRoot, await realpath(directory))) {
        throw new Error("Storage directories must not be symlinks");
      }
    }
  }

  private stagedPath(storageKey: string) {
    ensureKey(storageKey);
    return path.join(this.staging, `${storageKey}.part`);
  }

  private objectPath(storageKey: string) {
    ensureKey(storageKey);
    return path.join(this.objects, storageKey.slice(0, 2), storageKey);
  }

  private async ensureObjectDirectory(storageKey: string) {
    const target = path.dirname(this.objectPath(storageKey));
    await this.checkDirectory(this.objects);
    await mkdir(target, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    await this.checkDirectory(target);
  }

  private async checkDirectory(target: string, allowMissing = false) {
    const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
      if (allowMissing && error.code === "ENOENT") return null;
      throw new StorageUnavailableError("Storage directory unavailable", { cause: error });
    });
    if (!info) return false;
    const actual = await realpath(target);
    if (info.isSymbolicLink() || !info.isDirectory() || !samePath(target, actual)) {
      throw new StorageUnavailableError("Unsafe storage directory");
    }
    return true;
  }

  async writeStream(storageKey: string, source: Readable, maxBytes: number): Promise<StorageWriteResult> {
    await this.initialize();
    const staged = this.stagedPath(storageKey);
    await this.checkDirectory(this.staging);
    let descriptor: number | undefined;
    let ownsStage = false;
    const hash = createHash("sha256");
    let sizeBytes = 0;
    const headerParts: Buffer[] = [];
    let headerSize = 0;
    const inspect = new Transform({
      transform(chunk: Buffer | string, _encoding, callback) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        sizeBytes += buffer.length;
        if (sizeBytes > maxBytes) {
          callback(Object.assign(new Error("File exceeds the configured size limit"), { code: "FILE_TOO_LARGE" }));
          return;
        }
        hash.update(buffer);
        if (headerSize < 16) {
          const part = buffer.subarray(0, 16 - headerSize);
          headerParts.push(Buffer.from(part));
          headerSize += part.length;
        }
        callback(null, buffer);
      },
    });

    try {
      descriptor = await openDescriptor(staged, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
      ownsStage = true;
      const destination = createWriteStream(staged, { fd: descriptor, autoClose: true, flush: true });
      descriptor = undefined;
      await pipeline(source, inspect, destination);
      return { sizeBytes, sha256: hash.digest("hex"), header: Buffer.concat(headerParts) };
    } catch (error) {
      if (descriptor !== undefined) await closeDescriptor(descriptor);
      if (ownsStage) await this.removeStaged(storageKey).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "EACCES") {
        throw new StorageUnavailableError(undefined, { cause: error });
      }
      throw error;
    }
  }

  async finalize(storageKey: string) {
    await this.initialize();
    const staged = this.stagedPath(storageKey);
    const target = this.objectPath(storageKey);
    await this.checkDirectory(this.staging);
    await this.ensureObjectDirectory(storageKey);
    const stagedInfo = await lstat(staged).catch(() => null);
    if (!stagedInfo || stagedInfo.isSymbolicLink() || !stagedInfo.isFile()) throw new StorageObjectNotFoundError();
    const finalInfo = await lstat(target).catch(() => null);
    if (finalInfo) throw new StorageUnavailableError("Object key already exists");
    try {
      await rename(staged, target);
    } catch (error) {
      throw new StorageUnavailableError(undefined, { cause: error });
    }
  }

  async readStream(storageKey: string): Promise<Readable> {
    await this.initialize();
    const target = this.objectPath(storageKey);
    if (!(await this.checkDirectory(path.dirname(target), true))) throw new StorageObjectNotFoundError();
    const info = await lstat(target).catch(() => null);
    if (!info) throw new StorageObjectNotFoundError();
    if (info.isSymbolicLink() || !info.isFile()) throw new StorageUnavailableError("Unsafe storage object");
    let descriptor: number | undefined;
    try {
      descriptor = await openDescriptor(target, constants.O_RDONLY | NOFOLLOW);
      const openedInfo = await descriptorStat(descriptor);
      if (!openedInfo.isFile()) {
        await closeDescriptor(descriptor);
        descriptor = undefined;
        throw new StorageUnavailableError("Unsafe storage object");
      }
      const stream = createReadStream(target, { fd: descriptor, autoClose: true });
      descriptor = undefined;
      return stream;
    } catch (error) {
      if (descriptor !== undefined) await closeDescriptor(descriptor);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new StorageObjectNotFoundError();
      if (error instanceof StorageUnavailableError) throw error;
      throw new StorageUnavailableError(undefined, { cause: error });
    }
  }

  async readStagedStream(storageKey: string): Promise<Readable> {
    await this.initialize();
    const staged = this.stagedPath(storageKey);
    await this.checkDirectory(this.staging);
    const info = await lstat(staged).catch(() => null);
    if (!info) throw new StorageObjectNotFoundError();
    if (info.isSymbolicLink() || !info.isFile()) throw new StorageUnavailableError("Unsafe staging object");
    let descriptor: number | undefined;
    try {
      descriptor = await openDescriptor(staged, constants.O_RDONLY | NOFOLLOW);
      const openedInfo = await descriptorStat(descriptor);
      if (!openedInfo.isFile()) {
        await closeDescriptor(descriptor);
        descriptor = undefined;
        throw new StorageUnavailableError("Unsafe staging object");
      }
      const stream = createReadStream(staged, { fd: descriptor, autoClose: true });
      descriptor = undefined;
      return stream;
    } catch (error) {
      if (descriptor !== undefined) await closeDescriptor(descriptor);
      if (error instanceof StorageUnavailableError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new StorageObjectNotFoundError();
      throw new StorageUnavailableError(undefined, { cause: error });
    }
  }

  async delete(storageKey: string) {
    await this.initialize();
    const target = this.objectPath(storageKey);
    if (!(await this.checkDirectory(path.dirname(target), true))) return;
    const info = await lstat(target).catch(() => null);
    if (!info) return;
    if (info.isSymbolicLink() || !info.isFile()) throw new StorageUnavailableError("Unsafe storage object");
    try {
      await rm(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new StorageUnavailableError(undefined, { cause: error });
    }
  }

  async exists(storageKey: string) {
    await this.initialize();
    const target = this.objectPath(storageKey);
    if (!(await this.checkDirectory(path.dirname(target), true))) return false;
    const info = await lstat(target).catch(() => null);
    return Boolean(info?.isFile() && !info.isSymbolicLink());
  }

  async stat(storageKey: string): Promise<StorageStat | null> {
    await this.initialize();
    const target = this.objectPath(storageKey);
    if (!(await this.checkDirectory(path.dirname(target), true))) return null;
    const info = await lstat(target).catch(() => null);
    if (!info) return null;
    if (info.isSymbolicLink() || !info.isFile()) throw new StorageUnavailableError("Unsafe storage object");
    return { sizeBytes: info.size };
  }

  async hasStaged(storageKey: string) {
    await this.initialize();
    await this.checkDirectory(this.staging);
    const info = await lstat(this.stagedPath(storageKey)).catch(() => null);
    return Boolean(info?.isFile() && !info.isSymbolicLink());
  }

  async removeStaged(storageKey: string) {
    await this.initialize();
    const staged = this.stagedPath(storageKey);
    await this.checkDirectory(this.staging);
    const info = await lstat(staged).catch(() => null);
    if (info?.isSymbolicLink()) throw new StorageUnavailableError("Unsafe staging object");
    await rm(staged, { force: true });
  }

  async listStagedKeys() {
    await this.initialize();
    await this.checkDirectory(this.staging);
    const entries = await readdir(this.staging, { withFileTypes: true });
    return entries.flatMap((entry) => {
      const match = /^([a-f0-9]{64})\.part$/.exec(entry.name);
      return match && entry.isFile() && !entry.isSymbolicLink() ? [match[1]!] : [];
    });
  }
}
