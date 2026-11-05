/**
 * Busca o valor numérico do ponteiro (offset) salvo no Cloudflare KV.
 * Retorna 0 caso o binding do KV esteja ausente, a chave não exista ou ocorra erro.
 */
export async function getOffset(
  kv: KVNamespace,
  key: string
): Promise<(string | number)[]> {
  try {
    if (!kv) return [0];
    const value = await kv.get(key);
    return value ? JSON.parse(value) : [0];
  } catch (error) {
    console.error(`[getOffset] Erro ao buscar a chave '${key}': `, error);
    return [0];
  }
}
