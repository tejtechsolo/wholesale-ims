// Reads emails captured by the local Supabase stack's Mailpit (no real email is sent).
import { expect } from "@playwright/test";

const base = () => {
  const url = process.env.MAILPIT_URL;
  if (!url) throw new Error("E2E needs env MAILPIT_URL (from `supabase status -o env`)");
  return url.replace(/\/$/, "");
};

/** Waits for the newest email to `to` whose subject matches, and returns its /auth/confirm link. */
export async function confirmLinkFor(to: string, subject: RegExp, after = 0): Promise<string> {
  let link = "";
  await expect.poll(async () => {
    const res = await fetch(`${base()}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    if (!res.ok) throw new Error(`mailpit search ${res.status}: is MAILPIT_URL a Mailpit server?`);
    const { messages = [] } = (await res.json()) as { messages?: { ID: string; Subject: string; Created: string }[] };
    const msg = messages.find((m) => subject.test(m.Subject) && Date.parse(m.Created) >= after);
    if (!msg) return "";
    const full = (await (await fetch(`${base()}/api/v1/message/${msg.ID}`)).json()) as { HTML?: string; Text?: string };
    const m = (full.HTML ?? full.Text ?? "").match(/href="([^"]*\/auth\/confirm\?[^"]+)"/);
    link = m ? m[1].replace(/&amp;/g, "&") : "";
    return link;
  }, { timeout: 20_000, message: `email "${subject}" to ${to}` }).not.toBe("");
  return link;
}
