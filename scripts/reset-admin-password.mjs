#!/usr/bin/env node
/**
 * Resets the password of an EXISTING admin account. It never creates, deletes
 * or re-keys a user, and never touches `admin_users`: it only updates the Auth
 * password through the trusted server-side admin API, then confirms the user's
 * existing id is still listed in `admin_users`.
 *
 *   npm run admin:reset-password -- --remote you@example.com
 *
 * (The `--` matters: without it npm swallows --remote.) Uses NEXT_PUBLIC_SUPABASE_URL
 * and SUPABASE_SERVICE_ROLE_KEY from .env.local. Against any non-local URL the
 * --remote flag is mandatory. The new password is typed at a hidden prompt; it
 * and the service key are never printed or logged.
 */
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = process.argv.slice(2);
const allowRemote = args.includes("--remote");
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url ?? "");

if (!url || !serviceKey || !email) {
  console.error("Usage: npm run admin:reset-password -- [--remote] <email>");
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (.env.local).");
  process.exit(1);
}
if (!isLocal && !allowRemote) {
  console.error(`Refusing: ${new URL(url).host} is not a local Supabase stack. Add --remote to proceed.`);
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error("Run this in an interactive terminal: the password is prompted for and is never read from arguments or env.");
  process.exit(1);
}

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

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// Find the existing user (paged; matches the email exactly).
let user = null;
for (let page = 1; page <= 50 && !user; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.error("Could not list users:", error.message);
    process.exit(1);
  }
  user = data.users.find((u) => u.email?.toLowerCase() === email) ?? null;
  if (data.users.length < 200) break;
}
if (!user) {
  console.error(`No existing user with that email on ${new URL(url).host}. Nothing was changed (this tool never creates users).`);
  process.exit(1);
}
console.log(`Found user ${user.id.slice(0, 8)}… on ${new URL(url).host}.`);

const password = await promptHidden("New password (min 10 chars): ");
const again = await promptHidden("Repeat new password: ");
if (password !== again) {
  console.error("Passwords don't match. Nothing was changed.");
  process.exit(1);
}
if (password.length < 10) {
  console.error("Password must be at least 10 characters. Nothing was changed.");
  process.exit(1);
}

const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password });
if (updateError) {
  console.error("Password update failed:", updateError.message);
  process.exit(1);
}
console.log("Password updated.");

const { data: membership, error: memberError } = await supabase
  .from("admin_users")
  .select("user_id")
  .eq("user_id", user.id)
  .maybeSingle();
if (memberError) {
  console.error("Password was updated, but admin_users could not be read:", memberError.message);
  process.exit(1);
}
if (membership) {
  console.log("Verified: this user's id is still in admin_users.");
} else {
  console.warn(
    "WARNING: this user is NOT in admin_users, so they cannot access /admin. This tool does not modify admin_users; " +
      "add the row yourself (see README: Creating the first admin).",
  );
  process.exit(2);
}
