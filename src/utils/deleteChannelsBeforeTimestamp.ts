/**
 * Desativa os canais anteriores ao timestamp.
 */
export async function deleteChannelsBeforeTimestamp(
  db: D1Database,
  timestamp: string
): Promise<number> {

  const result = await db
    .prepare(`
      UPDATE "channels-m3u"
      SET active = 0
      WHERE datetime("date_registry") < datetime(?)
        AND active != 0
    `)
    .bind(timestamp)
    .run();

  return result.meta.changes ?? 0;
}
