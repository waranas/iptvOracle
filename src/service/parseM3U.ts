
import { thisTime } from "waranas";
import { getOffset } from "../utils/getOffset";
import { setOffset } from "../utils/setOffset";
import { searchM3U } from "../utils/searchM3U";
import { listRepo } from "../utils/listRepo";
import type { Env } from "../core/env";

const CURSOR_KEY = "parse_m3u_cursor";
const LAST_ID_KEY = "lastIdChannel";

const BATCH_SIZE = 100;
const REPO_BATCH_SIZE = 21;
const SELECT_BATCH_SIZE = 90;

interface ParsedChannel {
  name: string;
  url: string;
  sourceTvgId: string;
  groupTitle: string;
  logo: string;
}

interface ExistingChannel {
  "tvg-id": string;
  id_channel: number;
}

interface ParseControls {
  reduced?: boolean;
  gitHubPAT?: boolean;
}

export async function parseM3U(
  db: D1Database,
  kv: KVNamespace,
  env: Env,
  controls: ParseControls = {}
): Promise<void> {
  let stage = "inicialização";
  let fileName = "desconhecido";

  try {
    // 1. Recupera o cursor de processamento.
    stage = "leitura do cursor";

    const cursor = await getOffset(kv, CURSOR_KEY);

    const repoOffset = Math.max(
      0,
      Math.floor(Number(cursor?.[0]) || 0)
    );

    const fileOffset = Math.max(
      0,
      Math.floor(Number(cursor?.[1]) || 0)
    );

    const lineOffset = Math.max(
      0,
      Math.floor(Number(cursor?.[2]) || 0)
    );

    // 2. Busca os arquivos dos repositórios.
    stage = "leitura dos repositórios";

    const gitHubPAT = controls.gitHubPAT ?? false;

    const repoResult = await listRepo(
      db,
      repoOffset,
      REPO_BATCH_SIZE,
      gitHubPAT
        ? { gitHubPAT: env.GITHUB_PAT }
        : {}
    );

    // 3. Reinicia o cursor quando não houver arquivos.
    if (!repoResult.files || repoResult.files.length === 0) {
      console.log(
        "[Parse Oracle] Fila concluída. Reiniciando cursor."
      );

      await setOffset(kv, CURSOR_KEY, [0, 0, 0]);
      return;
    }

    // 4. Identifica o arquivo atual.
    const file = repoResult.files[fileOffset];

    if (!file) {
      const nextRepoOffset =
        repoResult.nextOffset ??
        repoOffset + REPO_BATCH_SIZE;

      await setOffset(kv, CURSOR_KEY, [
        nextRepoOffset,
        0,
        0,
      ]);

      console.log(
        `[Parse Oracle] Avançando para o offset ${nextRepoOffset}.`
      );

      return;
    }

    fileName = file.name;

    // 5. Recupera o conteúdo M3U a partir da linha salva.
    stage = "leitura do arquivo M3U";

    const source = await searchM3U(file, lineOffset);
    const lines = source.content.split(/\r?\n/);

    const parsedChannels: ParsedChannel[] = [];

    let i = source.currentLine;

    // 6. Interpreta o arquivo M3U.
    stage = "interpretação do arquivo M3U";

    while (
      i < lines.length &&
      parsedChannels.length < BATCH_SIZE
    ) {
      const textLine = lines[i].trim();

      if (textLine.startsWith("#EXTINF:")) {
        const streamUrl = lines[i + 1]?.trim();

        if (streamUrl && !streamUrl.startsWith("#")) {
          const nameMatch = textLine.match(/,(.*)$/);
          const tvgIdMatch = textLine.match(/tvg-id="([^"]*)"/i);
          const groupTitleMatch = textLine.match(/group-title="([^"]*)"/i);
          const logoMatch = textLine.match(/tvg-logo="([^"]*)"/i);

          parsedChannels.push({
            name: nameMatch?.[1]?.trim() || "-",
            url: streamUrl,
            sourceTvgId: tvgIdMatch?.[1]?.trim() || "",
            groupTitle: groupTitleMatch?.[1]?.trim() || "-",
            logo: logoMatch?.[1]?.trim() || "-",
          });

          // Consome também a linha da URL.
          i++;
        }
      }

      i++;
    }

    // 7. Prepara os canais para gravação.
    if (parsedChannels.length > 0) {
      stage = "preparação dos canais";

      const registryDate = thisTime();

      /*
       * Normaliza o tvg-id.
       *
       * Quando o arquivo não fornece um tvg-id,
       * utiliza o nome do canal como identificador.
       */
      const channelsMap = new Map<string, ParsedChannel>();

      for (const channel of parsedChannels) {
        const tvgId =
          channel.sourceTvgId ||
          channel.name.replace(/\s+/g, "_");

        // Evita duplicidade dentro do próprio lote.
        channelsMap.set(tvgId, channel);
      }

      const channels = Array.from(channelsMap.entries());

      const statements: D1PreparedStatement[] = [];
      const reduced = controls.reduced ?? false;

      // 8. Modo reduzido.
      if (reduced) {
        stage = "preparação do modo reduzido";

        for (const [tvgId, channel] of channels) {
          statements.push(
            db.prepare(`
              INSERT INTO "litleChannels-m3u" (
                name,
                url,
                "tvg-id",
                date_registry
              )
              VALUES (?, ?, ?, ?)

              ON CONFLICT("tvg-id") DO UPDATE SET
                name = excluded.name,
                url = excluded.url,
                date_registry = excluded.date_registry
            `).bind(
              channel.name,
              channel.url,
              tvgId,
              registryDate
            )
          );
        }
      } else {
        // 9. Modo normal: consulta os tvg-id existentes.
        stage = "consulta dos canais existentes";

        const tvgIds = channels.map(([tvgId]) => tvgId);

        const existingChannels = new Map<string, number>();

        // Consulta em grupos de até 90 identificadores.
        for (
          let offset = 0;
          offset < tvgIds.length;
          offset += SELECT_BATCH_SIZE
        ) {
          const batchIds = tvgIds.slice(
            offset,
            offset + SELECT_BATCH_SIZE
          );

          const placeholders = batchIds
            .map(() => "?")
            .join(", ");

          const result = await db.prepare(`
            SELECT "tvg-id", id_channel
            FROM "channels-m3u"
            WHERE "tvg-id" IN (${placeholders})
          `)
            .bind(...batchIds)
            .all<ExistingChannel>();

          for (const row of result.results ?? []) {
            existingChannels.set(
              row["tvg-id"],
              Number(row.id_channel)
            );
          }
        }

        // 10. Recupera o último ID utilizado pelo KV.
        stage = "leitura do último id_channel";

        const savedId = await kv.get(LAST_ID_KEY);

        let lastIdChannel = Math.max(
          3000,
          Math.floor(Number(savedId) || 0)
        );

        // 11. Prepara os UPSERTs do modo normal.
        stage = "preparação das inserções normais";

        for (const [tvgId, channel] of channels) {
          let idChannel = existingChannels.get(tvgId);

          // Somente canais novos recebem um novo ID.
          if (idChannel === undefined) {
            lastIdChannel++;
            idChannel = lastIdChannel;
          }

          statements.push(
            db.prepare(`
              INSERT INTO "channels-m3u" (
                id_channel,
                name,
                url,
                "tvg-id",
                "group-title",
                album,
                active,
                date_registry
              )
              VALUES (?, ?, ?, ?, ?, ?, 0, ?)

              ON CONFLICT("tvg-id") DO UPDATE SET
                name = excluded.name,
                url = excluded.url,
                "group-title" = excluded."group-title",
                album = excluded.album,
                date_registry = excluded.date_registry
            `).bind(
              idChannel,
              channel.name,
              channel.url,
              tvgId,
              channel.groupTitle,
              channel.logo,
              registryDate
            )
          );
        }

        // 12. Atualiza o contador no KV.
        stage = "atualização do último id_channel";

        if (
          lastIdChannel >
          Math.max(3000, Math.floor(Number(savedId) || 0))
        ) {
          await kv.put(
            LAST_ID_KEY,
            String(lastIdChannel)
          );
        }
      }

      // 13. Executa as gravações no D1.
      stage = "execução do batch no D1";

      await db.batch(statements);

      console.log(
        `[Parse Oracle] ${channels.length} canais processados ` +
        `em '${fileName}' no modo ${reduced ? "reduzido" : "normal"}.`
      );
    }

    // 14. Atualiza o cursor após o processamento bem-sucedido.
    stage = "atualização do cursor";

    if (i >= lines.length) {
      const nextFileOffset = fileOffset + 1;

      if (nextFileOffset >= repoResult.files.length) {
        const nextRepoOffset =
          repoResult.nextOffset ??
          repoOffset + REPO_BATCH_SIZE;

        await setOffset(kv, CURSOR_KEY, [
          nextRepoOffset,
          0,
          0,
        ]);
      } else {
        await setOffset(kv, CURSOR_KEY, [
          repoOffset,
          nextFileOffset,
          0,
        ]);
      }

      console.log(
        `[Parse Oracle] Arquivo '${fileName}' concluído.`
      );
    } else {
      await setOffset(kv, CURSOR_KEY, [
        repoOffset,
        fileOffset,
        i,
      ]);

      console.log(
        `[Parse Oracle] Lote salvo. Próxima linha: ${i} ` +
        `do arquivo '${fileName}'.`
      );
    }
  } catch (error: unknown) {
    const details =
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : {
            error: String(error),
          };

    console.error(
      `[Parse Oracle] Falha na etapa "${stage}" ` +
      `ao processar '${fileName}':`,
      JSON.stringify(details)
    );

    // Mantém o cursor anterior para permitir nova tentativa.
    throw error;
  }
}
