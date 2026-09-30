import { thisTime } from "waranas";
import type { m3uChannel } from "../interface/m3uChannel";
import { findChannelByTvgId } from "../utils/findChannel";
import { getMaxIdChannel } from "../utils/getMaxIdChannel";
import { listRepo } from "../utils/listRepo";
import { saveChannel } from "../utils/saveChannel";
import { searchM3U } from "../utils/searchM3U";

export async function parseM3U(
  db: D1Database,
): Promise<m3uChannel[]> {
  const channels: m3uChannel[] = [];

  const files = await listRepo(db);

  for (const file of files) {
    try {
      const source = await searchM3U(file.url);

      const lines = source.content.split(/\r?\n/);

      for (
        let index = 0;
        index < lines.length;
        index++
      ) {
        const line = lines[index].trim();

        if (!line.startsWith("#EXTINF:")) {
          continue;
        }

        const streamUrl = lines[index + 1]?.trim();

        if (
          !streamUrl ||
          streamUrl.startsWith("#")
        ) {
          continue;
        }

        const nameMatch =
          line.match(/,(.*)$/);

        const tvgIdMatch =
          line.match(/tvg-id="([^"]*)"/i);

        const groupTitleMatch =
          line.match(/group-title="([^"]*)"/i);

        const logoMatch =
          line.match(/tvg-logo="([^"]*)"/i);

        const name =
          nameMatch?.[1]?.trim() || "-";

        const sourceTvgId =
          tvgIdMatch?.[1]?.trim() || "";

        let existingChannel:
          m3uChannel | null = null;

        /*
         * Primeiro tenta localizar pelo tvg-id
         * quando ele existe na fonte.
         */
        if (sourceTvgId) {
          existingChannel =
            await findChannelByTvgId(
              db,
              sourceTvgId,
            );
        }

        let channelId: number;

        /*
         * Canal já cadastrado:
         * mantém o mesmo id_channel.
         */
        if (existingChannel) {
          channelId =
            existingChannel.id_channel;
        } else {
          /*
           * Canal novo:
           * gera um novo id_channel a partir de 3001.
           */
          channelId =
            await getMaxIdChannel(db);
        }

        /*
         * Se a fonte não possuir tvg-id,
         * utiliza o nome junto ao id_channel.
         */
        const tvgId =
          sourceTvgId ||
          `${name}_${channelId}`;

        /*
         * Verifica novamente o tvg-id gerado.
         */
        if (!existingChannel) {
          existingChannel =
            await findChannelByTvgId(
              db,
              tvgId,
            );

          if (existingChannel) {
            channelId =
              existingChannel.id_channel;
          }
        }

        const channel: m3uChannel = {
          id:
            existingChannel?.id ?? 0,
          id_channel: channelId,
          name,
          url: streamUrl,
          "tvg-id": tvgId,
          "group-title":
            groupTitleMatch?.[1]?.trim() ||
            "-",
          font_ref: file.repo_ref,
          album:
            logoMatch?.[1]?.trim() || "-",
          variant_refs:
            existingChannel?.variant_refs ??
            [],
          active: true,
          date_registry: thisTime(),
        };

        let savedChannel:
          m3uChannel | null;

        if (!existingChannel) {
          savedChannel =
            await saveChannel(
              db,
              channel,
            );
        } else {
          savedChannel =
            await saveChannel(
              db,
              channel,
              {
                "tvg-id":
                  channel["tvg-id"],
              },
            );
        }

        if (savedChannel) {
          channels.push(savedChannel);
        }

        /*
         * A próxima linha é a URL do stream.
         */
        index++;
      }
    } catch (error) {
      console.error(
        `Erro ao processar M3U "${file.name}" ` +
        `(${file.url}):`,
        error,
      );

      /*
       * O erro desta fonte não encerra
       * o processamento das próximas.
       */
      continue;
    }
  }

  return channels;
}
