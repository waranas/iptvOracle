import { runQuery } from "waranas";

export interface ChannelRow {
  [key: string]: unknown;
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

export async function readChannel(
  db: D1Database,
  cols?: string[],
  ref?: Record<string, string>,
): Promise<ChannelRow[]> {
  /*
   * Se nenhuma coluna for informada,
   * retorna todas as colunas.
   */
  const selectedColumns =
    cols && cols.length > 0
      ? cols
      : ["*"];

  /*
   * Valida as colunas solicitadas.
   */
  if (selectedColumns[0] !== "*") {
    for (const column of selectedColumns) {
      if (!channelColumns.has(column)) {
        throw new Error(
          `Coluna inexistente em "channels-m3u": ${column}`,
        );
      }
    }
  }

  /*
   * Monta a lista de colunas do SELECT.
   */
  const select = selectedColumns
    .map((column) =>
      column === "*"
        ? "*"
        : `"${column}"`,
    )
    .join(", ");

  /*
   * Sem referência:
   * retorna todos os registros.
   */
  if (!ref) {
    return await runQuery<ChannelRow>(
      `
        SELECT ${select}
        FROM "channels-m3u"
      `,
      db,
    );
  }

  /*
   * Referência vazia:
   * também retorna todos os registros.
   */
  const refEntries = Object.entries(ref);

  if (refEntries.length === 0) {
    return await runQuery<ChannelRow>(
      `
        SELECT ${select}
        FROM "channels-m3u"
      `,
      db,
    );
  }

  /*
   * Valida os campos usados como referência.
   */
  for (const [key] of refEntries) {
    if (!channelColumns.has(key)) {
      throw new Error(
        `Coluna de referência inexistente em "channels-m3u": ${key}`,
      );
    }
  }

  /*
   * Monta o WHERE.
   */
  const where = refEntries
    .map(([key]) => `"${key}" = ?`)
    .join(" AND ");

  const values = refEntries.map(
    ([, value]) => value,
  );

  /*
   * Executa a leitura filtrada.
   */
  return await runQuery<ChannelRow>(
    `
      SELECT ${select}
      FROM "channels-m3u"
      WHERE ${where}
    `,
    db,
    values,
  );
}
