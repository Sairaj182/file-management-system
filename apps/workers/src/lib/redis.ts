import { env } from "../env";
import Redis from "ioredis";

/**
 * All Redis keys used by Eduteria are prefixed with "emw:" so they never
 * collide with other applications sharing the same Redis server.
 * BullMQ queues use this as their `prefix` option; ioredis clients use it
 * as `keyPrefix`.
 */
export const REDIS_PREFIX = "emw";

const base = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
};

/** Raw ioredis connection options for BullMQ (DB 1). Pass alongside REDIS_PREFIX. */
export const bullmqConnection = { ...base, db: env.REDIS_DB };

/** Raw ioredis connection options for the API cache layer (DB 2). */
export const cacheConnection = {
  ...base,
  db: env.CACHE_REDIS_DB,
  keyPrefix: `${REDIS_PREFIX}:`,
};

/** Raw ioredis connection options for the Socket.io adapter (DB 3). */
export const socketConnection = {
  ...base,
  db: env.SOCKET_REDIS_DB,
  keyPrefix: `${REDIS_PREFIX}:`,
};

export const redisCache = new Redis(cacheConnection);
