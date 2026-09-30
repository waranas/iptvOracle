import { ensureTableExists, runQuery } from "waranas";
import { channelsM3uSchema } from "../schemas/channelsM3U";

export async function getMaxIdChannel(
  db: D1Database,
): Promise<number> {
  ensureTableExists(db, "channels-m3u", channelsM3uSchema());
  const result = await runQuery<{ max_id: number | null }>(
    `
      SELECT MAX(id_channel) AS max_id
      FROM "channels-m3u"
      WHERE id_channel >= 3001
    `,
    db,
  );

  const maxId = result[0]?.max_id;

  if (maxId === null || maxId === undefined) {
    return 3001;
  }

  return maxId + 1;
}
