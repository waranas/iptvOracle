export function litleChannelsM3uSchema(): string {
  return `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    "tvg-id" TEXT NOT NULL UNIQUE DEFAULT '-',
    date_registry INTEGER NOT NULL
  `.trim();
}
