import { runQuery } from "waranas";
import type { m3uFile } from "../interface/m3uFile";
import type { RepoM3U } from "../interface/m3uRepo";

interface GitHubFile {
  name: string;
  path: string;
  type: string;
  download_url: string | null;
}

export async function listRepo(
  db: D1Database,
): Promise<m3uFile[]> {
  const repos = await runQuery<RepoM3U>(
    `
      SELECT
        id,
        name,
        url,
        path
      FROM "repo-m3u"
    `,
    db,
  );

  const files: m3uFile[] = [];

  for (const repo of repos) {
    try {
      const repository = repo.url
        .replace(/^https?:\/\/github\.com\//, "")
        .replace(/\/$/, "");

      const apiUrl =
        `https://api.github.com/repos/${repository}/contents/${repo.path}`;

      const response = await fetch(apiUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "waranas-iptvOracle",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Erro ao listar fonte ${repo.name}: ` +
          `${response.status} ${response.statusText}`,
        );
      }

      const entries =
        await response.json() as GitHubFile[];

      for (const entry of entries) {
        if (entry.type !== "file") {
          continue;
        }

        if (
          !entry.name
            .toLowerCase()
            .endsWith(".m3u")
        ) {
          continue;
        }

        if (!entry.download_url) {
          continue;
        }

        files.push({
          name: entry.name,
          path: entry.path,
          url: entry.download_url,
          content: "",
          repo_ref: repo.id,
        });
      }
    } catch (error) {
      console.error(
        `Erro ao processar fonte ${repo.name}:`,
        error,
      );

      continue;
    }
  }

  return files;
}
