
import { thisTime } from "waranas";
import { getOffset } from "../utils/getOffset";
import { setOffset } from "../utils/setOffset";
import { searchM3U } from "../utils/searchM3U";
import { listRepo } from "../utils/listRepo";
import { getMaxIdChannel } from "../utils/getMaxIdChannel";

const CURSOR_KEY = "parse_m3u_cursor";
const BATCH_SIZE = 100;
const REPO_BATCH_SIZE = 21;

interface ParsedChannel {
  name: string;
  url: string;
  sourceTvgId: string;
  groupTitle: string;
  logo: string;
  active: number;
}

export async function parseM3U(
  db: D1Database,
  kv: KVNamespace
): Promise<void> {
  let stage = "inicialização";
  let fileName = "desconhecido";

  try {
    // 1. Recupera o cursor: [repoOffset, fileOffset, lineOffset].
    stage = "leitura do cursor";

    const cursor = await getOffset(kv, CURSOR_KEY);

    let repoOffset = Math.max(
      0,
      Math.floor(Number(cursor?.[0]) || 0)
    );

    let fileOffset = Math.max(
      0,
      Math.floor(Number(cursor?.[1]) || 0)
    );

    let lineOffset = Math.max(
      0,
      Math.floor(Number(cursor?.[2]) || 0)
    );

    // 2. Busca os arquivos dos repositórios.
    stage = "leitura dos repositórios";

    const repoResult = await listRepo(
      db,
      repoOffset,
      REPO_BATCH_SIZE
    );

    if (!repoResult.files || repoResult.files.length === 0) {
      console.log(
        "[Parse Oracle] Fila concluída. Reiniciando cursor."
      );

      await setOffset(kv, CURSOR_KEY, [0, 0, 0]);
      return;
    }

    // 3. Identifica o arquivo atual.
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

    // 4. Recupera o conteúdo a partir da linha salva.
    stage = "leitura do arquivo M3U";

    const source = await searchM3U(file, lineOffset);
    const lines = source.content.split(/\r?\n/);

    const parsedChannels: ParsedChannel[] = [];

    let i = source.currentLine;

    // 5. Interpreta o arquivo em memória.
    stage = "interpretação do arquivo M3U";

    while (i < lines.length && parsedChannels.length < BATCH_SIZE) {
      const textLine = lines[i].trim();

      if (textLine.startsWith("#EXTINF:")) {
        const streamUrl = lines[i + 1]?.trim();

        if (
          streamUrl &&
          !streamUrl.startsWith("#")
        ) {
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
            active: 0,
          });

          // Consome a linha da URL; o incremento ao final
          // do loop avança para a próxima entrada.
          i++;
        }
      }

      i++;
    }

    // 6. Grava os canais na tabela correta.
    if (parsedChannels.length > 0) {
      stage = "consulta do maior id_channel";

      let currentMaxChannelId = await getMaxIdChannel(db);

      if (
        !Number.isFinite(currentMaxChannelId) ||
        currentMaxChannelId < 3000
      ) {
        currentMaxChannelId = 3000;
      }

      stage = "preparação das inserções";

      const registryDate = thisTime();
      const statements: D1PreparedStatement[] = [];

      for (const channel of parsedChannels) {
        currentMaxChannelId++;

        const finalTvgId =
          channel.sourceTvgId ||
          `${channel.name.replace(/\s+/g, "_")}_${currentMaxChannelId}`;

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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)

            ON CONFLICT("tvg-id") DO UPDATE SET
              url = excluded.url,
              name = excluded.name,
              "group-title" = excluded."group-title",
              album = excluded.album
          `).bind(
            currentMaxChannelId,
            channel.name,
            channel.url,
            finalTvgId,
            channel.groupTitle,
            channel.logo,
            channel.active,
            registryDate
          )
        );
      }

      // O batch do D1 executa as instruções em uma operação.
      stage = "execução do batch no D1";

      await db.batch(statements);

      console.log(
        `[Parse Oracle] ${parsedChannels.length} canais processados ` +
        `em '${fileName}'.`
      );
    }

    // 7. Atualiza o cursor somente após o processamento bem-sucedido.
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

    // Não avança o cursor: a execução seguinte poderá
    // tentar novamente a partir do último progresso salvo.
    throw error;
  }
}
