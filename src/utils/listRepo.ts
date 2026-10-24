import { ensureTableExists, runQuery } from "waranas";
import type { m3uFile } from "../interface/m3uFile";
import type { RepoM3U } from "../interface/m3uRepo";
import { getOffset, updateOffset, resetOffset } from "../helppers/offset";

interface GitHubFile {
  name: string;
  path: string;
  type: string;
  download_url: string | null;
}

export interface ListRepoResult {
  files: m3uFile[];
  currentOffset: number;
  nextOffset: number | null;
  totalFiles: number;
  completed: boolean;
}

export async function listRepo(
  db: D1Database,
  kv: KVNamespace,
  batchSize: number = 21
): Promise<ListRepoResult> {
  // 1. Procura a posição atual gravada no KV (padrão: 0)
  const currentOffset = await getOffset(kv);

  // 2. Garante a tabela no D1 e procura os repositórios cadastrados
  await ensureTableExists(
    db,
    `"repo-m3u"`,
    "id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, url TEXT, path TEXT"
  );

  const repos = await runQuery<RepoM3U>(
    `
      SELECT
        id,
        name,
        url,
        path
      FROM "repo-m3u"
    `,
    db
  );

  const allFiles: m3uFile[] = [];

  // 3. Lê o repositório no GitHub
  for (const repo of repos) {
    try {
      const repository = repo.url
        .replace(/^https?:\/\/github\.com\//, "")
        .replace(/\/$/, "");

      const apiUrl = `https://api.github.com/repos/${repository}/contents/${repo.path}`;

      const response = await fetch(apiUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "waranas-iptvOracle",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Erro ao listar fonte ${repo.name}: ${response.status} ${response.statusText}`
        );
      }

      const entries = (await response.json()) as GitHubFile[];

      for (const entry of entries) {
        if (
          entry.type === "file" &&
          entry.name.toLowerCase().endsWith(".m3u") &&
          entry.download_url
        ) {
          allFiles.push({
            name: entry.name,
            path: entry.path,
            url: entry.download_url,
            content: "",
            repo_ref: repo.id,
          });
        }
      }
    } catch (error) {
      console.error(`Erro ao processar fonte ${repo.name}:`, error);
      continue;
    }
  }

  // 4. Extrai a fatia exata do lote
  const slicedFiles = allFiles.slice(currentOffset, currentOffset + batchSize);

  // 5. Se o lote tiver menos de 50 itens (ou for o último/vazio), reseta o KV
  if (slicedFiles.length < batchSize || currentOffset + slicedFiles.length >= allFiles.length) {
    await resetOffset(kv);

    console.log(
      `[listRepo] Último lote (menos de ${batchSize} itens: ${slicedFiles.length}). Ponteiro do KV resetado com sucesso.`
    );

    return {
      files: slicedFiles,
      currentOffset,
      nextOffset: null,
      totalFiles: allFiles.length,
      completed: true,
    };
  }

  // 6. Caso o lote seja completo (50 itens), atualiza o ponteiro normalmente no KV
  const { nextOffset, completed } = await updateOffset(
    kv,
    currentOffset,
    batchSize,
    allFiles.length
  );

  console.log(
    `[listRepo] Lote processado: itens ${currentOffset + 1} a ${currentOffset + slicedFiles.length} (Total: ${allFiles.length}) | Próximo offset: ${nextOffset}`
  );

  return {
    files: slicedFiles,
    currentOffset,
    nextOffset,
    totalFiles: allFiles.length,
    completed,
  };
}
