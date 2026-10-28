#!/usr/bin/env node
/**
 * Creates (or promotes) the portfolio owner's admin account.
 *
 *   node --env-file=.env.local scripts/create-admin.mjs you@example.com
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The service-role
 * key is used here, on your machine, and nowhere in the running application.
 * The password is read from the ADMIN_PASSWORD env var or prompted for (hidden).
 */
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.argv[2]?.trim().toLowerCase();

if (!url || !serviceKey || !email) {
  console.error(
    "Usage: node --env-file=.env.local scripts/create-admin.mjs <email>\n" +
      "Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
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

const password = process.env.ADMIN_PASSWORD ?? (await promptHidden("Password (min 10 chars): "));
if (!password || password.length < 10) {
  console.error("Password must be at least 10 characters.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let userId;
const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) {
  // Already registered: look the user up and (re)set the password.
  const list = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list.data?.users.find((u) => u.email?.toLowerCase() === email);
  if (!existing) {
    console.error("Could not create the user:", created.error.message);
    process.exit(1);
  }
  userId = existing.id;
  const updated = await supabase.auth.admin.updateUserById(userId, { password });
  if (updated.error) {
    console.error("Could not update the password:", updated.error.message);
    process.exit(1);
  }
  console.log(`User ${email} already existed; password updated.`);
} else {
  userId = created.data.user.id;
  console.log(`Created user ${email}.`);
}

const { error } = await supabase.from("admin_users").upsert({ user_id: userId });
if (error) {
  console.error("Could not add the user to admin_users:", error.message);
  process.exit(1);
}
console.log("Authorised as admin. You can now sign in at /admin/login.");
