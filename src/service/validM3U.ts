
import { getOffset } from "../utils/getOffset";
import { setOffset } from "../utils/setOffset";
import { verifyUrl } from "../utils/verifyUrl";

const KV_KEY_VALID_OFFSET = "valid_m3u_offset";

export interface ValidM3UResult {
  processedCount: number;
  nextOffset: number;
  completed: boolean;
}

/**
 * Oráculo de Validação Paginada (Verify Oracle).
 *
 * Busca canais na tabela "channels-m3u", verifica suas URLs,
 * atualiza o campo active no D1 e salva o progresso no KV.
 *
 * @param db Conexão com o Cloudflare D1.
 * @param kv Namespace do Cloudflare KV.
 * @param limit Quantidade de canais por lote (padrão: 20).
 */
export async function validM3U(
  db: D1Database,
  kv: KVNamespace,
  limit: number = 20
): Promise<ValidM3UResult> {
  let stage = "inicialização";

  try {
    // 1. Valida o limite do lote.
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Limite de validação inválido: ${limit}`);
    }

    // 2. Recupera o offset salvo no KV.
    stage = "leitura do offset no KV";

    const cursor = await getOffset(
      kv,
      KV_KEY_VALID_OFFSET
    );

    const currentOffset = Math.max(
      0,
      Math.floor(Number(cursor?.[0]) || 0)
    );

    // 3. Busca o lote na tabela correta.
    stage = "consulta dos canais no D1";

    const { results } = await db
      .prepare(`
        SELECT
          id_channel,
          "tvg-id" AS tvg_id,
          url
        FROM "channels-m3u"
        ORDER BY id_channel ASC
        LIMIT ? OFFSET ?
      `)
      .bind(limit, currentOffset)
      .all<{
        id_channel: number;
        tvg_id: string;
        url: string;
      }>();

    // 4. Se não houver mais canais, reinicia o ciclo.
    if (!results || results.length === 0) {
      stage = "reset do offset no KV";

      await setOffset(
        kv,
        KV_KEY_VALID_OFFSET,
        [0]
      );

      console.log(
        "[Valid Oracle] Fim da tabela alcançado. Offset resetado para 0."
      );

      return {
        processedCount: 0,
        nextOffset: 0,
        completed: true,
      };
    }

    // 5. Verifica as URLs em paralelo.
    stage = "verificação das URLs";

    const verificationResults = await Promise.all(
      results.map(async (channel) => {
        const isActive = await verifyUrl(channel.url);

        return {
          id_channel: channel.id_channel,
          isActive,
        };
      })
    );

    // 6. Prepara as atualizações usando id_channel.
    stage = "preparação dos UPDATEs";

    const statements: D1PreparedStatement[] = [];

    for (const result of verificationResults) {
      statements.push(
        db
          .prepare(`
            UPDATE "channels-m3u"
            SET active = ?
            WHERE id_channel = ?
          `)
          .bind(
            result.isActive ? 1 : 0,
            result.id_channel
          )
      );
    }

    // 7. Executa as atualizações em lote.
    stage = "execução do batch no D1";

    if (statements.length > 0) {
      await db.batch(statements);
    }

    // 8. Calcula o próximo offset.
    const nextOffset = currentOffset + results.length;

    // 9. Persiste o progresso no KV.
    stage = "gravação do próximo offset no KV";

    await setOffset(
      kv,
      KV_KEY_VALID_OFFSET,
      [nextOffset]
    );

    console.log(
      `[Valid Oracle] Lote validado: ${results.length} canais; ` +
      `offset anterior: ${currentOffset}; ` +
      `próximo offset: ${nextOffset}.`
    );

    return {
      processedCount: results.length,
      nextOffset,
      completed: false,
    };

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
      `[Valid Oracle] Erro na etapa "${stage}":`,
      JSON.stringify(details)
    );

    throw error;
  }
}
