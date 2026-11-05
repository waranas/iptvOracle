export function channelsM3uSchema(): string {
  return `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_channel INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    "tvg-id" TEXT UNIQUE,
    "group-title" TEXT,
    font_ref INTEGER NOT NULL,
    album TEXT NOT NULL,
    variant_refs TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT 1,
    date_registry INTEGER NOT NULL
  `.trim();
}
