#!/usr/bin/env node
/**
 * Read-only diagnostic for the admin sign-in flow. It replays what the app does,
 * step by step, and prints ONLY safe metadata (pass/fail, error codes, cookie
 * NAMES and SIZES, JWT algorithm, membership yes/no). It never prints the
 * password, any token, any cookie value or any key, and it changes no data
 * (it opens one session and signs it out again).
 *
 *   npm run admin:diagnose -- --remote you@example.com [--app http://localhost:3000]
 *
 * --app lets it also replay the resulting session cookies against a running copy
 * of the app (/admin and /admin/login) to see what the proxy and server do.
 */
import { createInterface } from "node:readline";
import { createServerClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const args = process.argv.slice(2);
const allowRemote = args.includes("--remote");
const appIdx = args.indexOf("--app");
const appUrl = appIdx >= 0 ? args[appIdx + 1] : undefined;
const email = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--app")?.trim().toLowerCase();
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url ?? "");

if (!url || !anonKey || !email) {
  console.error("Usage: npm run admin:diagnose -- [--remote] <email> [--app http://localhost:3000]");
  process.exit(1);
}
if (!isLocal && !allowRemote) {
  console.error(`Refusing: ${new URL(url).host} is not local. Add --remote to proceed.`);
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error("Run in an interactive terminal (the password is prompted for, never read from args/env).");
  process.exit(1);
}

const ok = (label, detail = "") => console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
const bad = (label, detail = "") => console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
const info = (label, detail = "") => console.log(`  info  ${label}${detail ? ` — ${detail}` : ""}`);

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = rl._writeToOutput;
    rl._writeToOutput = (text) => (text.includes(question) ? write.call(rl, text) : undefined);
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

/** JWT header algorithm only — never the payload or signature. */
function jwtAlg(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()).alg;
  } catch {
    return "unreadable";
  }
}

console.log(`Target Supabase: ${new URL(url).host}${isLocal ? " (local)" : " (REMOTE)"}`);
if (appUrl) console.log(`Replaying against app: ${appUrl}`);
const password = await promptHidden("Password (hidden, used only for this check): ");

// In-memory cookie jar, driven by the same @supabase/ssr code the app uses.
const jar = new Map();
let headersSeen = null;
const makeClient = () =>
  createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list, headers) => {
        if (headers && Object.keys(headers).length) headersSeen = headers;
        for (const { name, value } of list) {
          if (value === "") jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });

console.log("\n1. Sign in (what the login server action does)");
const supabase = makeClient();
const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
if (signInError) {
  bad("signInWithPassword", `code=${signInError.code ?? "?"} status=${signInError.status ?? "?"} message="${signInError.message}"`);
  console.log("\nStopped: authentication itself failed, so the problem is the credentials/Auth, not cookies.");
  process.exit(1);
}
ok("signInWithPassword", `session returned: ${Boolean(signIn.session)}, user returned: ${Boolean(signIn.user)}`);
info("access token algorithm", String(jwtAlg(signIn.session.access_token)));

console.log("\n2. Cookies the app would set");
const names = [...jar.keys()];
if (names.length === 0) bad("auth cookies written", "none — setAll was not called with a session");
else ok("auth cookies written", `${names.length}`);
for (const [name, value] of jar) info(`cookie ${name}`, `${value.length} bytes`);
const total = [...jar].reduce((n, [k, v]) => n + k.length + v.length + 3, 0);
info("total Cookie header added by auth", `${total} bytes (Node rejects a request whose headers exceed ~16 KB with HTTP 431)`);
info("Cache-Control passed to setAll", headersSeen ? headersSeen["Cache-Control"] ?? "(other headers)" : "none provided");

console.log("\n3. Server-side verification (proxy / route guard use getClaims)");
const server = makeClient();
const { data: claims, error: claimsError } = await server.auth.getClaims();
if (claimsError || !claims?.claims?.sub) bad("getClaims", claimsError ? `${claimsError.name}: ${claimsError.message}` : "no claims returned");
else ok("getClaims", `verified identity present (role=${claims.claims.role ?? "?"}, aal=${claims.claims.aal ?? "?"})`);

console.log("\n4. Admin authorisation (is_admin() and admin_users)");
const { data: isAdmin, error: adminError } = await server.rpc("is_admin");
if (adminError) bad("is_admin()", `code=${adminError.code} message="${adminError.message}"`);
else if (isAdmin === true) ok("is_admin()", "true");
else bad("is_admin()", "false — this account is authenticated but not in admin_users");
const uid = claims?.claims?.sub;
if (uid) {
  const { data: row, error } = await server.from("admin_users").select("user_id").eq("user_id", uid).maybeSingle();
  if (error) bad("admin_users row visible to the user", error.message);
  else if (row) ok("admin_users row visible to the user");
  else bad("admin_users row visible to the user", "no row for this user id");
}

if (appUrl) {
  console.log("\n5. Replay the session against the running app");
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  for (const path of ["/admin", "/admin/login", "/admin/projects"]) {
    try {
      const r = await fetch(new URL(path, appUrl), { redirect: "manual", headers: { cookie } });
      const setCookies = r.headers.getSetCookie?.() ?? [];
      const verdict = r.status === 431 ? "431 header too large" : `${r.status}${r.headers.get("location") ? ` -> ${r.headers.get("location")}` : ""}`;
      info(`GET ${path}`, `${verdict}; Set-Cookie names: ${setCookies.map((c) => c.split("=")[0]).join(", ") || "none"}; cache-control: ${r.headers.get("cache-control") ?? "-"}`);
    } catch (e) {
      bad(`GET ${path}`, e instanceof Error ? e.message : "request failed");
    }
  }
  info("expected for a healthy admin", "/admin -> 200, /admin/login -> redirect to /admin");
}

await server.auth.signOut({ scope: "local" }).catch(() => {});
console.log("\nDone. Nothing was modified; the diagnostic session was signed out.");
