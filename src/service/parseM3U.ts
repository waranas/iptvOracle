import { thisTime } from "waranas";
import type { m3uChannel } from "../interface/m3uChannel";
import { searchM3U } from "../utils/searchM3U";
import { listRepo, type ListRepoResult } from "../utils/listRepo";
import { getMaxIdChannel } from "../utils/getMaxIdChannel";
import { verifyUrl } from "../utils/verifyUrl";

export async function parseM3U(
  db: D1Database,
  kv: KVNamespace,
): Promise<m3uChannel[]> {
  const channels: m3uChannel[] = [];

  const files: ListRepoResult = await listRepo(db, kv);

  // 1. Busca o ID máximo de canal UMA única vez para o controle em memória
  let currentMaxChannelId = await getMaxIdChannel(db);
  if (!currentMaxChannelId || currentMaxChannelId < 3000) {
    currentMaxChannelId = 3000;
  }

  for (const file of files.files) {
    try {
      const source = await searchM3U(file.url);
      const lines = source.content.split(/\r?\n/);

      const parsedLines = [];

      // FASE 1: Parse super-rápido na memória (Sem chamadas ao banco)
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index].trim();

        if (!line.startsWith("#EXTINF:")) {
          continue;
        }

        const streamUrl = lines[index + 1]?.trim();

        if (!streamUrl || streamUrl.startsWith("#")) {
          continue;
        }

        const nameMatch = line.match(/,(.*)$/);
        const tvgIdMatch = line.match(/tvg-id="([^"]*)"/i);
        const groupTitleMatch = line.match(/group-title="([^"]*)"/i);
        const logoMatch = line.match(/tvg-logo="([^"]*)"/i);

        parsedLines.push({
          name: nameMatch?.[1]?.trim() || "-",
          url: streamUrl,
          sourceTvgId: tvgIdMatch?.[1]?.trim() || "",
          groupTitle: groupTitleMatch?.[1]?.trim() || "-",
          logo: logoMatch?.[1]?.trim() || "-",
          fontRef: file.repo_ref,
          active: false
        });

        // Pula a linha da URL
        index++;
      }

      // FASE 2: Processamento em Lotes (Chunks) de 90 itens
            const BATCH_SIZE = 90;
            for (let i = 0; i < parsedLines.length; i += BATCH_SIZE) {
              const chunk = parsedLines.slice(i, i + BATCH_SIZE);

              // 2. Pega apenas os tvg-ids que vieram da fonte para checar existência
              const validSourceTvgIds = chunk
                .map(ch => ch.sourceTvgId)
                .filter(id => id !== "");

              // 3. Mapa para guardar os canais que já existem
              const existingMap = new Map<string, { id_channel: number }>();

              // Busca em lote todos os canais deste chunk que já existem no D1
              if (validSourceTvgIds.length > 0) {
                const placeholders = validSourceTvgIds.map(() => "?").join(",");

                // Nota: Ajuste as colunas no SELECT se o seu variant_refs for gravado no banco
                const { results } = await db.prepare(
                  `SELECT "tvg-id", id_channel FROM "channels-m3u" WHERE "tvg-id" IN (${placeholders})`
                ).bind(...validSourceTvgIds).all();

                for (const row of results) {
                  existingMap.set(row.tvg_id as string, {
                    id_channel: row.id_channel as number
                  });
                }
              }

              const statements = [];

              // 4. Constrói os preparos SQL de inserção
              for (let j = 0; j < chunk.length; j++) {
                const ch = chunk[j];
                const isChannelActive = false; // Resgata o resultado da verificação paralela
                let channelId: number;

                // Verifica se o canal já existe pelo tvg-id da fonte
                if (ch.sourceTvgId && existingMap.has(ch.sourceTvgId)) {
                  channelId = existingMap.get(ch.sourceTvgId)!.id_channel;
                } else {
                  // Se não existe, usamos a memória para gerar o novo ID
                  currentMaxChannelId++;
                  channelId = currentMaxChannelId;
                }

                // Cria o tvgId final (igual a sua lógica original: usa o source ou gera um com o id)
                const finalTvgId = ch.sourceTvgId || `${ch.name}_${channelId}`;
                const registryDate = thisTime();

                // Prepara a Query (UPSERT)
                const stmt = db.prepare(`
                  INSERT INTO "channels-m3u" (id_channel, name, url, "tvg-id", "group-title", font_ref, album, variant_refs, active, date_registry)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT("tvg-id") DO UPDATE SET
                    url = excluded.url,
                    name = excluded.name,
                    date_registry = excluded.date_registry
                `).bind(
                  channelId,
                  ch.name,
                  ch.url,
                  finalTvgId,
                  ch.groupTitle,
                  "--empty--",
                  "--empty--",
                  ch.fontRef,
                  isChannelActive, // Utiliza a flag correta testada na rede
                  registryDate
                );

                statements.push(stmt);

                // Atualiza o estado da entidade e popula a array de retorno
                ch.active = isChannelActive;

                channels.push({
                  id: 0,
                  id_channel: channelId,
                  name: ch.name,
                  url: ch.url,
                  "tvg-id": finalTvgId,
                  "group-title": ch.groupTitle,
                  font_ref: ch.fontRef,
                  album: ch.logo,
                  variant_refs: [], // Ajuste caso busque do banco
                  active: ch.active,
                  date_registry: registryDate,
                });
              }

              // 5. Executa a inserção dos 100 canais de uma vez só no banco
              if (statements.length > 0) {
                await db.batch(statements);
              }
            }

    } catch (error) {
      console.error(
        `Erro ao processar M3U "${file.name}" ` +
        `(${file.url}):`,
        error,
      );
      continue; // Erro em um arquivo não trava os demais
    }
  }

  return channels;
}
