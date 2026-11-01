/** Remembers a small UI preference (list/kanban view, board columns) for a year. `path` keeps it to the area it belongs to (/admin, or / on the CRM host). */
export function rememberPreference(name: string, value: string, path: "/admin" | "/" = "/admin"): void {
  document.cookie = `${name}=${value}; path=${path}; max-age=31536000; samesite=lax`;
}
