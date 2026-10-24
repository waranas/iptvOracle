export async function resetOffset(kv: KVNamespace): Promise<void> {
  await kv.delete("repo_m3u_offset");
  console.log("[Offset] Ponteiro resetado para 0 com sucesso.");
}
