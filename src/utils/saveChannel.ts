// src/utils/saveChannel.ts

import { ensureTableExists, runQuery } from "waranas";
import type { m3uChannel } from "../interface/m3uChannel";
import { channelsM3uSchema } from "../schemas/channelsM3U";

interface ChannelRef {
  [key: string]: string;
}

/*
 * Colunas existentes em "channels-m3u"
 * que podem ser utilizadas como referência.
 */
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

export async function saveChannel(
  db: D1Database,
  channel: m3uChannel,
  ref?: ChannelRef,
): Promise<m3uChannel | null> {
  /*
   * Sem referência:
   * cria um novo registro.
   */

  ensureTableExists(db, "channels-m3u", channelsM3uSchema());
  if (!ref) {
    const query = `
      INSERT INTO "channels-m3u" (
        id_channel,
        name,
        url,
        "tvg-id",
        "group-title",
        font_ref,
        album,
        variant_refs,
        active,
        date_registry
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      channel.id_channel,
      channel.name,
      channel.url,
      channel["tvg-id"],
      channel["group-title"],
      channel.font_ref,
      channel.album,
      JSON.stringify(channel.variant_refs),
      channel.active ? 1 : 0,
      channel.date_registry,
    ];

    await runQuery(query, db, values);

    /*
     * Recupera o ID criado pelo D1.
     */
    const inserted = await runQuery<{
      id: number;
    }>(
      `
        SELECT id
        FROM "channels-m3u"
        WHERE id_channel = ?
        LIMIT 1
      `,
      db,
      [channel.id_channel],
    );

    const insertedChannel = inserted[0];

    if (!insertedChannel) {
      return null;
    }

    return {
      ...channel,
      id: insertedChannel.id,
    };
  }

  /*
   * Com referência:
   * procura o registro usando as referências
   * e atualiza o registro encontrado.
   */
  const refEntries = Object.entries(ref);

  if (refEntries.length === 0) {
    return null;
  }

  /*
   * Garante que todas as referências
   * correspondam a colunas existentes.
   */
  for (const [key] of refEntries) {
    if (!channelColumns.has(key)) {
      throw new Error(
        `Coluna de referência inexistente em "channels-m3u": ${key}`,
      );
    }
  }

  /*
   * Monta o WHERE somente depois
   * da validação das colunas.
   */
  const where = refEntries
    .map(([key]) => `"${key}" = ?`)
    .join(" AND ");

  const refValues = refEntries.map(([, value]) => value);

  /*
   * Procura o registro existente.
   */
  const existing = await runQuery<{
    id: number;
    id_channel: number;
  }>(
    `
      SELECT
        id,
        id_channel
      FROM "channels-m3u"
      WHERE ${where}
      LIMIT 1
    `,
    db,
    refValues,
  );

  const found = existing[0];

  /*
   * A referência não encontrou nenhum registro.
   */
  if (!found) {
    return null;
  }

  /*
   * Atualiza os dados do canal e
   * registra o momento da atualização.
   *
   * id e id_channel permanecem os mesmos
   * do registro original.
   */
  const query = `
    UPDATE "channels-m3u"
    SET
      name = ?,
      url = ?,
      "tvg-id" = ?,
      "group-title" = ?,
      font_ref = ?,
      album = ?,
      variant_refs = ?,
      active = ?,
      date_registry = ?
    WHERE id = ?
  `;

  const values = [
    channel.name,
    channel.url,
    channel["tvg-id"],
    channel["group-title"],
    channel.font_ref,
    channel.album,
    JSON.stringify(channel.variant_refs),
    channel.active ? 1 : 0,
    channel.date_registry,
    found.id,
  ];

  await runQuery(query, db, values);

  /*
   * Retorna o canal já com os identificadores
   * reais do registro existente.
   */
  return {
    ...channel,
    id: found.id,
    id_channel: found.id_channel,
  };
}
