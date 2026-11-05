
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

interface ListRepoControls {
  gitHubPAT?: string;
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
  offset: number = 0,
  batchSize: number = 21,
  controls: ListRepoControls = {}
): Promise<ListRepoResult> {
  const currentOffset = offset ?? 0;

  const { gitHubPAT } = controls;

  if (
    gitHubPAT !== undefined &&
    (typeof gitHubPAT !== "string" || !gitHubPAT.trim())
  ) {
    throw new Error("controls.gitHubPAT deve ser uma string não vazia.");
  }

  // 1. Garante a existência da tabela e busca os repositórios cadastrados.
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

  // 2. Busca os arquivos nos repositórios do GitHub.
  for (const repo of repos) {
    try {
      const repository = repo.url
        .replace(/^https?:\/\/github\.com\//, "")
        .replace(/\/$/, "");

      const path = repo.path.replace(/^\/+|\/+$/g, "");

      const apiUrl =
        `https://api.github.com/repos/${repository}/contents/` +
        path.split("/").map(encodeURIComponent).join("/");

      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "waranas-iptvOracle",
        "X-GitHub-Api-Version": "2022-11-28",
      };

      if (gitHubPAT) {
        headers.Authorization = `Bearer ${gitHubPAT}`;
      }

      const response = await fetch(apiUrl, { headers });

      if (!response.ok) {
        const responseBody = await response.text();

        console.error("[listRepo] Erro na resposta do GitHub:", {
          repository: repo.name,
          repoId: repo.id,
          url: apiUrl,
          status: response.status,
          statusText: response.statusText,
          response: responseBody.slice(0, 2000),
          rateLimit: {
            limit: response.headers.get("x-ratelimit-limit"),
            remaining: response.headers.get("x-ratelimit-remaining"),
            reset: response.headers.get("x-ratelimit-reset"),
          },
        });

        throw new Error(
          `Erro ao listar fonte ${repo.name}: ` +
          `${response.status} ${response.statusText}`
        );
      }

      const result = await response.json();

      // 3. Se path aponta para um arquivo, considera somente esse arquivo.
      if (!Array.isArray(result)) {
        const entry = result as GitHubFile;

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

        continue;
      }

      // 4. Se path aponta para um diretório, mantém o comportamento original.
      for (const entry of result as GitHubFile[]) {
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
      console.error(`[listRepo] Erro ao processar fonte ${repo.name}:`, error);
      continue;
    }
  }

  // 5. Extrai o lote a partir do offset, mantendo a paginação original.
  const slicedFiles = allFiles.slice(
    currentOffset,
    currentOffset + batchSize
  );

  const endOffset = currentOffset + slicedFiles.length;

  const completed =
    endOffset >= allFiles.length ||
    slicedFiles.length < batchSize;

  const nextOffset = completed ? null : endOffset;

  console.log(
    `[listRepo] Lote processado: itens ${currentOffset + 1} a ${endOffset} ` +
    `(Total: ${allFiles.length}) | Próximo offset: ${nextOffset}`
  );

  // 6. Retorna a mesma estrutura da versão anterior.
  return {
    files: slicedFiles,
    currentOffset,
    nextOffset,
    totalFiles: allFiles.length,
    completed,
  };
}
