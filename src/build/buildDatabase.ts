import { mkdir, access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { channelsM3uSchema } from "../schemas/channelsM3U";
import { litleChannelsM3uSchema } from "../schemas/litleChannelsM3U";
import { repoM3uSchema } from "../schemas/repo-m3u";

/**
 * Gera a migração inicial com os schemas do Oracle.
 */
export async function buildDatabase(): Promise<void> {
  const migrationsDir = join(process.cwd(), "migrations");
  const migrationFile = join(migrationsDir, "0001_initial.sql");

  await mkdir(migrationsDir, { recursive: true });

  // Não sobrescreve uma migração que já pode ter sido aplicada.
  try {
    await access(migrationFile);
    console.log("[Database] Migração inicial já existe.");
    return;
  } catch {
    // Arquivo ainda não existe.
  }

  const schemas = [
    {
      table: "channels-m3u",
      schema: channelsM3uSchema()
    },
    {
      table: "litleChannels-m3u",
      schema: litleChannelsM3uSchema()
    },
    {
      table: "repo-m3u",
      schema: repoM3uSchema()
    }
  ];

  const sql = schemas
    .map(({ table, schema }) => `
CREATE TABLE IF NOT EXISTS "${table}" (
${schema}
);
`.trim())
    .join("\n\n");

  await writeFile(migrationFile, `${sql}\n`, "utf-8");

  console.log("[Database] Schemas gerados com sucesso.");
}
