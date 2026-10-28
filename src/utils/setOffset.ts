/**
 * Grava a nova posição do ponteiro (offset) no Cloudflare KV.
 */
export async function setOffset(
  kv: KVNamespace,
  key: string,
  offset: ( number | string )[]
): Promise<boolean> {
  try {
    if (!kv) return false;
    await kv.put(key, JSON.stringify(offset));
    return true;
  } catch (error) {
    console.error(`[setOffset] Erro ao gravar a chave '${key}':`, error);
    return false;
  }
}
