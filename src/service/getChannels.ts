import { readChannel } from "../utils/readChannel";
import { removeEmptyChannelsProperty } from "../utils/removeEmptyChannelsProperty";

export async function getChannels(
  db: D1Database,
  cols?: string[],
  ref?: Record<string, string>,
) {
  const channels = await readChannel(
    db,
    cols,
    ref,
  );

  return channels.map((channel) =>
    removeEmptyChannelsProperty(channel),
  );
}
