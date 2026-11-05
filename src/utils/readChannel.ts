
import { ensureTableExists, runQuery } from "waranas";
import { channelsM3uSchema } from "../schemas/channelsM3U";

export interface ChannelRow {
  [key: string]: unknown;
}

export type ChannelFilters = Record<
  string,
  string | number | boolean | null
>;

export interface ChannelPagination {
  limit?: number;
  offset?: number;
}

const channelColumns = new Set([
  "id",
  "id_channel",
  "name",
  "url",
  "tvg-id",
  "group-title",
  "font_ref",
  "album",
  "variant_refs",
  "active",
  "date_registry",
]);

function normalizeValue(value: unknown): unknown {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  return value;
}

export async function readChannel(
  db: D1Database,
  cols?: string[],
  ref?: Record<string, string>,
  filters?: ChannelFilters,
  pagination?: ChannelPagination,
): Promise<ChannelRow[]> {
  await ensureTableExists(
    db,
    '"channels-m3u"',
    channelsM3uSchema(),
  );

  // Define as colunas selecionadas.
  const selectedColumns =
    cols && cols.length > 0 ? cols : ["*"];

  // Valida as colunas.
  if (!selectedColumns.includes("*")) {
    for (const column of selectedColumns) {
      if (!channelColumns.has(column)) {
        throw new Error(
          `Coluna inexistente em "channels-m3u": ${column}`,
        );
      }
    }
  } else if (selectedColumns.length > 1) {
    throw new Error(
      'Não combine "*" com outras colunas em cols.',
    );
  }

  const select = selectedColumns
    .map((column) =>
      column === "*" ? "*" : `"${column}"`,
    )
    .join(", ");

  // Monta o WHERE.
  const conditions: string[] = [];
  const values: unknown[] = [];

  const refEntries = Object.entries(ref ?? {});
  const filterEntries = Object.entries(filters ?? {});

  // Condições de referência.
  for (const [key, value] of refEntries) {
    if (!channelColumns.has(key)) {
      throw new Error(
        `Coluna de referência inexistente em "channels-m3u": ${key}`,
      );
    }

    if (value === null || value === undefined) {
      conditions.push(`"${key}" IS NULL`);
    } else {
      conditions.push(`"${key}" = ?`);
      values.push(normalizeValue(value));
    }
  }

  // Condições de filtro.
  for (const [key, value] of filterEntries) {
    if (!channelColumns.has(key)) {
      throw new Error(
        `Coluna de filtro inexistente em "channels-m3u": ${key}`,
      );
    }

    if (value === null) {
      conditions.push(`"${key}" IS NULL`);
    } else {
      conditions.push(`"${key}" = ?`);
      values.push(normalizeValue(value));
    }
  }

  const where =
    conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

  // Monta LIMIT e OFFSET.
  let paginationSQL = "";

  if (pagination !== undefined) {
    const { limit, offset = 0 } = pagination;

    if (
      limit !== undefined &&
      (!Number.isSafeInteger(limit) || limit < 1)
    ) {
      throw new Error(
        "pagination.limit deve ser um inteiro positivo.",
      );
    }

    if (
      !Number.isSafeInteger(offset) ||
      offset < 0
    ) {
      throw new Error(
        "pagination.offset deve ser um inteiro não negativo.",
      );
    }

    if (limit !== undefined) {
      paginationSQL += " LIMIT ?";
      values.push(limit);
    }

    if (limit !== undefined || offset > 0) {
      if (limit === undefined) {
        paginationSQL += " LIMIT -1";
      }

      paginationSQL += " OFFSET ?";
      values.push(offset);
    }
  }

  // Executa a consulta.
  return await runQuery<ChannelRow>(
    `
      SELECT ${select}
      FROM "channels-m3u"
      ${where}
      ORDER BY "id_channel" ASC
      ${paginationSQL}
    `,
    db,
    values,
  );
}
