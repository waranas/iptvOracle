import type { m3uFile } from "../interface/m3uFile";

export async function searchM3U(
  url: string,
): Promise<m3uFile> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Erro ao buscar M3U: ${response.status} ${response.statusText}`,
    );
  }

  return {
    name: url.split("/").pop() || "-",
    path: url,
    url,
    content: await response.text(),
    repo_ref: 0,
  };
}
