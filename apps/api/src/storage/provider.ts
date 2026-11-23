import type { Readable } from "node:stream";

export type StorageWriteResult = { sizeBytes: number; sha256: string; header: Buffer };
export type StorageStat = { sizeBytes: number };

export interface StorageProvider {
  writeStream(storageKey: string, source: Readable, maxBytes: number): Promise<StorageWriteResult>;
  finalize(storageKey: string): Promise<void>;
  readStream(storageKey: string): Promise<Readable>;
  readStagedStream?(storageKey: string): Promise<Readable>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  stat?(storageKey: string): Promise<StorageStat | null>;
  hasStaged?(storageKey: string): Promise<boolean>;
  listStagedKeys?(): Promise<string[]>;
  removeStaged?(storageKey: string): Promise<void>;
}

export class StorageUnavailableError extends Error {
  readonly code = "STORAGE_UNAVAILABLE";
  constructor(message = "File storage is unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "StorageUnavailableError";
  }
}

export class StorageObjectNotFoundError extends Error {
  readonly code = "STORAGE_OBJECT_NOT_FOUND";
  constructor() {
    super("Stored object was not found");
    this.name = "StorageObjectNotFoundError";
  }
}
