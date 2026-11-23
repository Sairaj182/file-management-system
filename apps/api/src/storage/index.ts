import { env } from "../env";
import { LocalFilesystemStorage } from "./local-filesystem";

export const storage = new LocalFilesystemStorage(env.FILE_STORAGE_ROOT);
export { LocalFilesystemStorage } from "./local-filesystem";
export type { StorageProvider, StorageWriteResult, StorageStat } from "./provider";
export { StorageObjectNotFoundError, StorageUnavailableError } from "./provider";
