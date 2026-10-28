
import { ensureTableExists } from "waranas";

import { readChannel } from "../utils/readChannel";
import type {
  ChannelFilters,
  ChannelPagination,
} from "../utils/readChannel";

import { removeEmptyChannelsProperty } from "../utils/removeEmptyChannelsProperty";
import { channelsM3uSchema } from "../schemas/channelsM3U";

export async function getChannels(
  db: D1Database,
  cols?: string[],
  ref?: Record<string, string>,
  filters?: ChannelFilters,
  pagination?: ChannelPagination,
) {
  await ensureTableExists(
    db,
    '"channels-m3u"',
    channelsM3uSchema(),
  );

  const channels = await readChannel(
    db,
    cols,
    ref,
    filters,
    pagination,
  );

  return channels.map((channel) =>
    removeEmptyChannelsProperty(channel),
  );
}
