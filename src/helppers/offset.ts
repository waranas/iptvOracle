export async function getOffset(kv: KVNamespace): Promise<number> {
  const value = await kv.get("repo_m3u_offset");
  return value ? parseInt(value, 10) : 0;
}

export async function updateOffset(
  kv: KVNamespace,
  currentOffset: number,
  batchSize: number,
  totalFiles: number
): Promise<{ nextOffset: number | null; completed: boolean }> {
  const nextOffset = currentOffset + batchSize;

  // Se o próximo offset alcançar ou ultrapassar o total de arquivos, o ciclo terminou
  if (nextOffset >= totalFiles) {
    // Remove o ponteiro do KV para que a próxima execução recomece automaticamente do índice 0
    await kv.delete("repo_m3u_offset");
    return { nextOffset: null, completed: true };
  }

  // Grava o novo ponteiro no KV para a próxima chamada
  await kv.put("repo_m3u_offset", String(nextOffset));
  return { nextOffset, completed: false };
}

export async function resetOffset(kv: KVNamespace): Promise<void> {
  await kv.delete("repo_m3u_offset");
}
