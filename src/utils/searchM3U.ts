import type { m3uFile } from "../interface/m3uFile";

export interface SearchM3UResult extends m3uFile {
  currentLine: number;
}

/**
 * Busca e baixa o conteúdo de um arquivo M3U mantendo a referência do arquivo e da linha de processamento.
 *
 * @param file Objeto m3uFile do arquivo em processamento ou a URL em string.
 * @param line Índice numérico da linha do arquivo onde o processamento deve iniciar/retomar (padrão: 0).
 */
export async function searchM3U(
  file: m3uFile | string,
  line: number = 0
): Promise<SearchM3UResult> {
  // Constrói o objeto base caso seja recebida apenas a string da URL
  const fileObj: m3uFile =
    typeof file === "string"
      ? {
          name: file.split("/").pop() || "-",
          path: file,
          url: file,
          content: "",
          repo_ref: 0, // 0 por padrão caso não haja referência prévia
        }
      : file;

  const response = await fetch(fileObj.url);

  if (!response.ok) {
    throw new Error(
      `Erro ao buscar M3U "${fileObj.name}": ${response.status} ${response.statusText}`
    );
  }

  // Retorna o objeto preservando as propriedades originais e anexando o conteúdo e a linha
  return {
    ...fileObj,
    content: await response.text(),
    currentLine: line,
  };
}
