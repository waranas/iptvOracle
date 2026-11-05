export function repoM3uSchema(): string {
  return `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    path TEXT NOT NULL
  `.trim();
}
