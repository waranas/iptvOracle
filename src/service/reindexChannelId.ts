
const LAST_ID_KEY = "last_channel_id";

export async function reindexChannelId(
  db: D1Database,
  kv: KVNamespace,
  initId: number
): Promise<number | null> {
  if (!Number.isSafeInteger(initId) || initId < 1) {
    throw new Error("initId deve ser um inteiro positivo.");
  }

  // Etapa 1: desloca os IDs para uma faixa negativa exclusiva.
  const moveToNegative = db.prepare(`
    WITH numbered AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          ORDER BY id_channel ASC, id ASC
        ) AS rn
      FROM "channels-m3u"
    )
    UPDATE "channels-m3u"
    SET id_channel = -(
      SELECT rn
      FROM numbered
      WHERE numbered.id = "channels-m3u".id
    )
  `);

  // Etapa 2: reindexa em ordem crescente, começando em initId.
  const reindex = db.prepare(`
    WITH numbered AS (
      SELECT
        id,
        ? + ROW_NUMBER() OVER (
          ORDER BY id_channel DESC, id ASC
        ) - 1 AS new_id
      FROM "channels-m3u"
      WHERE id_channel < 0
    )
    UPDATE "channels-m3u"
    SET id_channel = (
      SELECT new_id
      FROM numbered
      WHERE numbered.id = "channels-m3u".id
    )
  `).bind(initId);

  // Etapa 3: conta os registros dentro da mesma transação.
  const count = db.prepare(`
    SELECT COUNT(*) AS total
    FROM "channels-m3u"
  `);

  // As três instruções são executadas em uma única transação.
  const results = await db.batch([
    moveToNegative,
    reindex,
    count,
  ]);

  const countResult = results[2].results?.[0] as
    | { total: number }
    | undefined;

  const total = Number(countResult?.total ?? 0);

  if (total === 0) {
    return null;
  }

  const lastId = initId + total - 1;

  // Atualiza o KV somente após o sucesso da transação D1.
  await kv.put(LAST_ID_KEY, String(lastId));

  return lastId;
}
