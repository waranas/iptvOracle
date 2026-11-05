import { deleteChannelsBeforeTimestamp } from "../utils/deleteChannelsBeforeTimestamp";
import { normalizeTimestamp } from "../utils/normalizeTimestap";

/**
 * Exclui os canais antigos da tabela channels-m3u.
 *
 * @param db D1 database.
 * @param timestamp Limite de data para exclusão.
 * @returns Quantidade de registros excluídos.
 */
export async function deleteOldChannels(
  db: D1Database,
  timestamp: string | number | Date
): Promise<number> {

  const normalizedTimestamp =
    normalizeTimestamp(timestamp);

  const deleted =
    await deleteChannelsBeforeTimestamp(
      db,
      normalizedTimestamp
    );

  console.log(
    `[deleteOldChannels] ${deleted} canais removidos.`
  );

  return deleted;
}
