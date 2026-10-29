// TOTP codes for the E2E admin/manager accounts. Each TOTP code is used at most once:
// we never assume Supabase Auth accepts a replayed code.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOTP } from "otpauth";

export const AUTH_DIR = join(import.meta.dirname, ".auth");
export const MFA_USERS = ["admin", "manager"] as const;
export type MfaUser = (typeof MFA_USERS)[number];

const stateFile = (who: MfaUser) => join(AUTH_DIR, `${who}.totp.json`);
export const storageFile = (who: MfaUser) => join(AUTH_DIR, `${who}.json`);

const totp = (secret: string) => new TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" });
const period = () => Math.floor(Date.now() / 30_000);

export function saveSecret(who: MfaUser, secret: string) {
  writeFileSync(stateFile(who), JSON.stringify({ secret, lastPeriod: -1 }));
}

/** A code from a 30 s window this user has not used yet (waits ≤ 30 s if needed). */
export async function freshCode(who: MfaUser): Promise<string> {
  if (!existsSync(stateFile(who))) throw new Error(`no TOTP secret for ${who}: did mfa.setup run?`);
  const state = JSON.parse(readFileSync(stateFile(who), "utf8")) as { secret: string; lastPeriod: number };
  while (period() <= state.lastPeriod) await new Promise((r) => setTimeout(r, 500));
  const p = period();
  // Avoid the last second of a window: the server could see the next one.
  if (30_000 - (Date.now() % 30_000) < 1500) await new Promise((r) => setTimeout(r, 1600));
  state.lastPeriod = Math.max(p, period());
  writeFileSync(stateFile(who), JSON.stringify(state));
  return totp(state.secret).generate();
}
