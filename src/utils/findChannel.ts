import { ensureTableExists, runQuery } from "waranas";
import type { m3uChannel } from "../interface/m3uChannel";
import { channelsM3uSchema } from "../schemas/channelsM3U";

interface m3uChannelRow {
  id: number;
  id_channel: number;
  name: string;
  url: string;
  "tvg-id": string;
  "group-title": string;
  font_ref: number;
  album: string;
  variant_refs: string;
  active: number;
  date_registry: number;
}

export async function findChannelByTvgId(
  db: D1Database,
  tvgId: string,
): Promise<m3uChannel | null> {
  ensureTableExists(db, "channels-m3u", channelsM3uSchema());
  const result = await runQuery<m3uChannelRow>(
    `
      SELECT
        id,
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
      FROM "channels-m3u"
      WHERE "tvg-id" = ?
      LIMIT 1
    `,
    db,
    [tvgId],
  );

  const channel = result[0];

  if (!channel) {
    return null;
  }

  let variantRefs: number[] = [];

  try {
    const parsed: unknown = JSON.parse(channel.variant_refs);

    if (
      Array.isArray(parsed) &&
      parsed.every((value) => Number.isInteger(value))
    ) {
      variantRefs = parsed;
    }
  } catch {
    variantRefs = [];
  }

  return {
    id: channel.id,
    id_channel: channel.id_channel,
    name: channel.name,
    url: channel.url,
    "tvg-id": channel["tvg-id"],
    "group-title": channel["group-title"],
    font_ref: channel.font_ref,
    album: channel.album,
    variant_refs: variantRefs,
    active: channel.active === 1,
    date_registry: channel.date_registry
  };
}
