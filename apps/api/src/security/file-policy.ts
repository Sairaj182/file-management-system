import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";

export const MAX_DISPLAY_FILENAME_BYTES = 255;
const allowedExtensions = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

export function createStorageKey() {
  return randomBytes(32).toString("hex");
}

export function normalizeFilename(input: string) {
  const normalized = input.normalize("NFKC").split(/[\\/]/).pop()?.trim() ?? "";
  if (!normalized || normalized === "." || normalized === "..") throw new Error("Invalid filename");
  if ([...normalized].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || (codePoint >= 0x202a && codePoint <= 0x202e) || (codePoint >= 0x2066 && codePoint <= 0x2069);
  })) throw new Error("Filename contains disallowed control characters");
  if (Buffer.byteLength(normalized, "utf8") > MAX_DISPLAY_FILENAME_BYTES) throw new Error("Filename exceeds 255 UTF-8 bytes");
  return normalized;
}

export function inspectAllowedContent(header: Buffer, filename: string) {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  const claimedByName = allowedExtensions.get(extension);
  if (!claimedByName) return null;

  let detected: string | null = null;
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) detected = "image/png";
  else if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) detected = "image/jpeg";
  else if (header.length >= 12 && header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP") detected = "image/webp";

  return detected && detected === claimedByName ? detected : null;
}

export type SignedFileClaims = { dockyardId: string; fileId: string; expiresAt: number };

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSignedFileToken(claims: SignedFileClaims, secret: string) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifySignedFileToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000), maxTtlSeconds = 300): SignedFileClaims | null {
  if (token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]!)) return null;
  const actual = Buffer.from(parts[1]!, "base64url");
  const expected = Buffer.from(signature(parts[0]!, secret), "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as Partial<SignedFileClaims>;
    if (typeof value.dockyardId !== "string" || !value.dockyardId || typeof value.fileId !== "string" || !value.fileId) return null;
    if (!Number.isInteger(value.expiresAt) || value.expiresAt! <= nowSeconds || value.expiresAt! > nowSeconds + maxTtlSeconds) return null;
    return { dockyardId: value.dockyardId, fileId: value.fileId, expiresAt: value.expiresAt! };
  } catch {
    return null;
  }
}
