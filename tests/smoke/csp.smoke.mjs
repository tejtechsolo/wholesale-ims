// Smoke test against a RUNNING production build:  BASE_URL=http://localhost:3000 node tests/smoke/csp.smoke.mjs
// Checks: every <script> carries this response's nonce; nonces differ per request;
// signed-out users are redirected (with CSP on the redirect too).
const base = process.env.BASE_URL ?? "http://localhost:3000";
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };

async function page(path) {
  const res = await fetch(base + path, { redirect: "manual" });
  return { res, csp: res.headers.get("content-security-policy") ?? "", html: await res.text() };
}

const a = await page("/login");
const b = await page("/login");
const nonceOf = (csp) => csp.match(/'nonce-([^']+)'/)?.[1];
const na = nonceOf(a.csp), nb = nonceOf(b.csp);

if (a.res.status !== 200) fail(`/login status ${a.res.status}`);
if (!na) fail("no nonce in CSP header");
if (na === nb) fail("nonce reused across requests");
if (/script-src[^;]*unsafe-inline/.test(a.csp)) fail("script-src allows unsafe-inline");

const scripts = [...a.html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
if (scripts.length === 0) fail("no <script> tags found (unexpected for a Next.js page)");
const bad = scripts.filter((t) => !t.includes(`nonce="${na}"`));
if (bad.length) fail(`${bad.length}/${scripts.length} script tags without the nonce: ${bad[0]}`);

const r = await page("/orders");
if (r.res.status !== 307 || !r.res.headers.get("location")?.includes("/login?next=%2Forders"))
  fail(`/orders signed-out: expected 307 to /login, got ${r.res.status} ${r.res.headers.get("location")}`);
if (!nonceOf(r.csp)) fail("redirect response is missing CSP");

if (!process.exitCode) console.log(`PASS: ${scripts.length} scripts nonce-stamped, nonces unique, redirect OK`);
