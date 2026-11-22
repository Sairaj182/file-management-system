import { parsePhoneNumberFromString } from "libphonenumber-js";

export function normalizeRecoveryPhone(value: string): string | null {
  const parsed = parsePhoneNumberFromString(value, "IN");
  return parsed?.isValid() ? parsed.number : null;
}
