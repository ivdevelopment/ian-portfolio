/**
 * "Delete draft" -> "Deleting draft…". Action buttons say what is happening instead of a generic "Loading…".
 * Unknown verbs fall back to "Working…" (callers with a special case pass their own label).
 */
const GERUNDS: Record<string, string> = {
  add: "Adding",
  approve: "Approving",
  archive: "Archiving",
  cancel: "Cancelling",
  change: "Changing",
  check: "Checking",
  confirm: "Confirming",
  connect: "Connecting",
  convert: "Converting",
  copy: "Copying",
  create: "Creating",
  delete: "Deleting",
  disable: "Disabling",
  disconnect: "Disconnecting",
  download: "Downloading",
  duplicate: "Duplicating",
  enable: "Enabling",
  export: "Exporting",
  extend: "Extending",
  feature: "Featuring",
  generate: "Generating",
  import: "Importing",
  link: "Linking",
  mark: "Marking",
  move: "Moving",
  publish: "Publishing",
  regenerate: "Regenerating",
  remove: "Removing",
  reopen: "Reopening",
  reset: "Resetting",
  restore: "Restoring",
  revoke: "Revoking",
  save: "Saving",
  send: "Sending",
  set: "Setting",
  sign: "Signing",
  sync: "Syncing",
  unfeature: "Unfeaturing",
  unlink: "Unlinking",
  unpublish: "Unpublishing",
  update: "Updating",
  upload: "Uploading",
  validate: "Validating",
};

export function pendingLabel(label: string): string {
  const [first, ...rest] = label.replace(/[….]+$/, "").trim().split(/\s+/);
  const gerund = GERUNDS[(first ?? "").toLowerCase()];
  if (!gerund) return "Working…";
  return `${[gerund, ...rest].join(" ")}…`;
}
