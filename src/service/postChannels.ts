
export interface PostChannelsControls {
  targetURL?: string;
  columns?: string[];
  reduce?: boolean;
  filters?: Record<string, string | number | boolean | null>;
}

export interface SyncResult {
  sent: number;
  nextCursor: number;
  completed: boolean;
}

interface SyncRow {
  __cursor_id: number;
  [key: string]: unknown;
}

const TABLES = {
  normal: '"channels-m3u"',
  reduced: '"litleChannels-m3u"',
} as const;

const ALLOWED_COLUMNS = {
  normal: new Set([
    "id",
    "id_channel",
    "name",
    "url",
    "tvg-id",
    "group-title",
    "font_ref",
    "album",
    "variant_refs",
    "active",
    "date_registry",
  ]),

  reduced: new Set([
    "id",
    "name",
    "url",
    "tvg-id",
    "date_registry",
  ]),
} as const;

const BATCH_SIZE = 90;

const CURSOR_KEYS = {
  normal: "sync_channels_last_id",
  reduced: "sync_litle_channels_last_id",
} as const;

/**
 * Gera o hash SHA-256 do segredo HTTP.
 */
async function hashHttpKey(httpKey: string): Promise<string> {
  const data = new TextEncoder().encode(httpKey);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Envia canais do D1 para outro Worker via HTTP.
 */
export async function postChannels(
  db: D1Database,
  kv: KVNamespace,
  controls?: PostChannelsControls,
  httpKey?: string,
): Promise<SyncResult> {

  // Define o modo
  const reduce = controls?.reduce ?? false;
  const mode = reduce ? "reduced" : "normal";

  const table = TABLES[mode];
  const allowedColumns = ALLOWED_COLUMNS[mode];
  const cursorKey = CURSOR_KEYS[mode];

  // Valida a URL
  const targetURL = controls?.targetURL?.trim();

  if (!targetURL) {
    throw new Error("A URL de destino (targetURL) não foi informada.");
  }

  let parsedURL: URL;

  try {
    parsedURL = new URL(targetURL);
  } catch {
    throw new Error("A URL de destino é inválida.");
  }

  if (parsedURL.protocol !== "https:") {
    throw new Error("A URL de destino precisa utilizar HTTPS.");
  }

  // Valida o segredo
  if (!httpKey?.trim()) {
    throw new Error("O segredo httpKey não foi informado.");
  }

  // Define as colunas retornadas
  const columns = controls?.columns?.length
    ? controls.columns
    : [...allowedColumns];

  if (new Set(columns).size !== columns.length) {
    throw new Error("A lista de colunas contém valores duplicados.");
  }

  for (const column of columns) {
    if (!allowedColumns.has(column)) {
      throw new Error(
        `A coluna "${column}" não é permitida no modo ${mode}.`,
      );
    }
  }

  if (!columns.length) {
    throw new Error("Nenhuma coluna foi selecionada.");
  }

  // Valida e prepara os filtros
  const filters = controls?.filters ?? {};
  const filterEntries = Object.entries(filters);

  const filterConditions: string[] = [];
  const filterValues: (string | number)[] = [];

  for (const [column, value] of filterEntries) {

    if (!allowedColumns.has(column)) {
      throw new Error(
        `A coluna "${column}" não pode ser utilizada como filtro no modo ${mode}.`,
      );
    }

    const sqlColumn = `"${column}"`;

    // NULL utiliza IS NULL
    if (value === null) {
      filterConditions.push(`${sqlColumn} IS NULL`);
      continue;
    }

    // Boolean é convertido para 1 ou 0
    const normalizedValue =
      typeof value === "boolean"
        ? Number(value)
        : value;

    filterConditions.push(`${sqlColumn} = ?`);
    filterValues.push(normalizedValue);
  }

  // Recupera o cursor
  const savedCursor = await kv.get(cursorKey);

  const cursor = Math.max(
    0,
    Number.parseInt(savedCursor ?? "0", 10) || 0,
  );

  // Monta a consulta
  const selectedColumns = columns
    .map((column) => `"${column}"`)
    .join(", ");

  const whereFilters = filterConditions.length
    ? `AND ${filterConditions.join(" AND ")}`
    : "";

  const query = `
    SELECT
      "id" AS "__cursor_id",
      ${selectedColumns}
    FROM ${table}
    WHERE "id" > ?
    ${whereFilters}
    ORDER BY "id" ASC
    LIMIT ?
  `;

  // Busca até 90 registros
  const result = await db
    .prepare(query)
    .bind(cursor, ...filterValues, BATCH_SIZE)
    .all<SyncRow>();

  const rows = result.results ?? [];

  // Finaliza quando não existem mais registros
  if (!rows.length) {
    await kv.put(cursorKey, "0");

    return {
      sent: 0,
      nextCursor: 0,
      completed: true,
    };
  }

  // Identifica o último ID do lote
  const nextCursor = Number(
    rows[rows.length - 1].__cursor_id,
  );

  // Remove o cursor interno
  const payload = rows.map(({ __cursor_id, ...row }) => row);

  // Gera o hash do segredo
  const hashedKey = await hashHttpKey(httpKey);

  // Envia para o servidor receptor
  const response = await fetch(targetURL, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      "X-HTTP-Key": hashedKey,
    },

    body: JSON.stringify(payload),
  });

  // Não avança o cursor em caso de falha
  if (!response.ok) {
    const responseText = await response.text().catch(() => "");

    throw new Error(
      `Falha ao enviar lote: HTTP ${response.status}. ${responseText}`,
    );
  }

  // Atualiza o cursor após sucesso
  await kv.put(cursorKey, String(nextCursor));

  return {
    sent: rows.length,
    nextCursor,
    completed: false,
  };
}
