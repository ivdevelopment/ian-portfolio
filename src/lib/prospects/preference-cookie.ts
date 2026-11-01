/** Remembers a small UI preference (list/kanban view, board columns) for a year, for the admin area only. */
export function rememberPreference(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/admin; max-age=31536000; samesite=lax`;
}
