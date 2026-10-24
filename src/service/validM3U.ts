import { verifyUrl } from "../utils/verifyUrl";

export interface ValidM3UResult {
    processedCount: number;
    nextOffset: number;
    completed: boolean;
}

/**
 * Valida um lote de canais do D1 por paginação, atualiza o status e salva o offset no KV.
 * 
 * @param db Conexão com o Cloudflare D1
 * @param kv Namespace do Cloudflare KV
 * @param limit Quantidade de canais por página (recomendado: 20 a 30 para respeitar limites de subrequests)
 * @returns Resumo da execução contendo o progresso e o próximo offset
 */
export async function validM3U(
    db: D1Database,
    kv: KVNamespace,
    limit: number = 20
): Promise<ValidM3UResult> {
    const KV_KEY_OFFSET = "valid_m3u_offset";

    try {
        // 1. Recupera o último offset salvo no KV (se não existir, começa do 0)
        const savedOffsetStr = await kv.get(KV_KEY_OFFSET);
        const currentOffset = savedOffsetStr ? parseInt(savedOffsetStr, 10) : 0;

        // 2. Busca o lote de canais no D1 usando LIMIT e OFFSET
        const { results } = await db.prepare(
            `SELECT id_channel, tvg_id, url FROM canais ORDER BY id_channel ASC LIMIT ? OFFSET ?`
        ).bind(limit, currentOffset).all<{ id_channel: number, tvg_id: string, url: string }>();

        // Se a listagem vier vazia, resetamos o ponteiro para o início e encerramos o ciclo
        if (!results || results.length === 0) {
            await kv.put(KV_KEY_OFFSET, "0");
            console.log("[validM3U] Fim da lista alcançado. Offset resetado para 0.");
            return { processedCount: 0, nextOffset: 0, completed: true };
        }

        // 3. Valida as URLs do lote em paralelo (concorrência controlada pelo tamanho do limite)
        const verificationResults = await Promise.all(
            results.map(async (channel) => {
                const isActive = await verifyUrl(channel.url);
                return { tvg_id: channel.tvg_id, isActive };
            })
        );

        // 4. Prepara as instruções de UPDATE em lote para o banco D1
        const statements = [];
        for (const res of verificationResults) {
            statements.push(
                db.prepare(`UPDATE canais SET active = ? WHERE tvg_id = ?`)
                .bind(res.isActive ? 1 : 0, res.tvg_id)
            );
        }

        if (statements.length > 0) {
            await db.batch(statements);
        }

        // 5. Calcula o próximo offset e salva o estado atualizado no KV
        const nextOffset = currentOffset + results.length;
        await kv.put(KV_KEY_OFFSET, nextOffset.toString());

        console.log(`[validM3U] Processados ${results.length} canais (Offset anterior: ${currentOffset} | Próximo: ${nextOffset})`);

        return {
            processedCount: results.length,
            nextOffset,
            completed: false
        };

    } catch (error) {
        console.error("[validM3U] Erro ao executar a validação paginada:", error);
        throw error;
    }
}
