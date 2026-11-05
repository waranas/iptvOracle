
const BATCH_SIZE = 9;
const MAX_REQUESTS_PER_CHANNEL = 5;
const REQUIRED_SEGMENTS = 3;
const MAX_CONCURRENT_CHANNELS = 3;
const REQUEST_TIMEOUT_MS = 3_000;
const CURSOR_KEY = "last_validated_id";

interface ChannelRecord {
  id: number;
  id_channel: number;
  url: string;
}

interface RequestBudget {
  used: number;
}

interface ValidationResult {
  valid: boolean;
  requests: number;
  reason?: string;
}

interface ValidResult {
  processedCount: number;
  invalidatedCount: number;
  nextCursor: number;
  completed: boolean;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

async function fetchWithBudget(
  input: string,
  budget: RequestBudget
): Promise<Response | null> {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  while (budget.used < MAX_REQUESTS_PER_CHANNEL) {
    budget.used++;

    let response: Response;

    try {
      response = await fetch(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Accept: "*/*",
        },
      });
    } catch {
      return null;
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get("Location");

    if (response.body) {
      await response.body.cancel().catch(() => undefined);
    }

    if (!location) {
      return null;
    }

    try {
      url = new URL(location, url);
    } catch {
      return null;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
  }

  return null;
}

async function readPlaylist(
  response: Response
): Promise<string | null> {
  if (response.status !== 200 || !response.body) {
    return null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;

      // Limita a memória usada pela playlist.
      if (totalBytes > 1_000_000) {
        await reader.cancel();
        return null;
      }

      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    return null;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");

  if (!text.trimStart().startsWith("#EXTM3U")) {
    return null;
  }

  return text;
}

function getFirstVariant(
  playlist: string,
  baseUrl: string
): string | null {
  const lines = playlist.split(/\r?\n/).map((line) => line.trim());

  for (let i = 0; i < lines.length; i++) {
    if (!/^#EXT-X-STREAM-INF:/i.test(lines[i])) {
      continue;
    }

    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j]) continue;

      if (lines[j].startsWith("#")) {
        continue;
      }

      try {
        return new URL(lines[j], baseUrl).toString();
      } catch {
        return null;
      }
    }
  }

  return null;
}

function getSegments(
  playlist: string,
  baseUrl: string
): string[] {
  const lines = playlist.split(/\r?\n/).map((line) => line.trim());
  const segments: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith("#")) {
      continue;
    }

    try {
      const url = new URL(line, baseUrl);

      if (url.protocol === "http:" || url.protocol === "https:") {
        segments.push(url.toString());
      }
    } catch {
      // Ignora URLs inválidas.
    }
  }

  return segments;
}

async function testSegment(
  url: string,
  budget: RequestBudget
): Promise<boolean> {
  const response = await fetchWithBudget(url, budget);

  if (!response) {
    return false;
  }

  if (response.status !== 200 || !response.body) {
    if (response.body) {
      await response.body.cancel().catch(() => undefined);
    }

    return false;
  }

  const reader = response.body.getReader();

  try {
    // Lê apenas o primeiro bloco para confirmar que há dados.
    const { done, value } = await reader.read();

    return !done && !!value && value.byteLength > 0;
  } catch {
    return false;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function validateStream(
  channel: ChannelRecord
): Promise<ValidationResult> {
  const budget: RequestBudget = { used: 0 };

  try {
    if (!channel.url) {
      return {
        valid: false,
        requests: 0,
        reason: "URL vazia.",
      };
    }

    // Requisição 1: tenta carregar a playlist inicial.
    const firstResponse = await fetchWithBudget(
      channel.url,
      budget
    );

    if (!firstResponse || firstResponse.status !== 200) {
      if (firstResponse?.body) {
        await firstResponse.body.cancel().catch(() => undefined);
      }

      return {
        valid: false,
        requests: budget.used,
        reason: "Falha ao carregar a playlist inicial.",
      };
    }

    const firstPlaylist = await readPlaylist(firstResponse);

    if (!firstPlaylist) {
      return {
        valid: false,
        requests: budget.used,
        reason: "Resposta não contém uma playlist HLS válida.",
      };
    }

    let mediaPlaylist = firstPlaylist;
    let mediaPlaylistUrl = channel.url;

    // Playlist master: busca a playlist de mídia da variante.
    // Essa requisição também conta no limite de 5.
    const variantUrl = getFirstVariant(
      firstPlaylist,
      channel.url
    );

    if (variantUrl) {
      const variantResponse = await fetchWithBudget(
        variantUrl,
        budget
      );

      if (!variantResponse || variantResponse.status !== 200) {
        if (variantResponse?.body) {
          await variantResponse.body.cancel().catch(() => undefined);
        }

        return {
          valid: false,
          requests: budget.used,
          reason: "Falha ao carregar a playlist da variante.",
        };
      }

      const variantPlaylist = await readPlaylist(variantResponse);

      if (!variantPlaylist) {
        return {
          valid: false,
          requests: budget.used,
          reason: "Playlist da variante inválida.",
        };
      }

      mediaPlaylist = variantPlaylist;
      mediaPlaylistUrl = variantUrl;
    }

    const segments = getSegments(
      mediaPlaylist,
      mediaPlaylistUrl
    );

    if (segments.length < REQUIRED_SEGMENTS) {
      return {
        valid: false,
        requests: budget.used,
        reason: "A playlist não contém 3 segmentos de mídia.",
      };
    }

    let validSegments = 0;

    for (const segmentUrl of segments) {
      if (budget.used >= MAX_REQUESTS_PER_CHANNEL) {
        break;
      }

      const valid = await testSegment(segmentUrl, budget);

      if (valid) {
        validSegments++;
      }

      if (validSegments >= REQUIRED_SEGMENTS) {
        return {
          valid: true,
          requests: budget.used,
        };
      }
    }

    return {
      valid: false,
      requests: budget.used,
      reason: `Somente ${validSegments} segmentos válidos foram recebidos.`,
    };
  } catch (error) {
    return {
      valid: false,
      requests: budget.used,
      reason: error instanceof Error ? error.message : "Erro desconhecido.",
    };
  }
}

async function selectChannels(
  db: D1Database,
  cursor: number
): Promise<ChannelRecord[]> {
  const result = await db
    .prepare(`
      SELECT id, id_channel, url
      FROM "channels-m3u"
      WHERE active = 1
        AND id > ?
      ORDER BY id ASC
      LIMIT ?
    `)
    .bind(cursor, BATCH_SIZE)
    .all<ChannelRecord>();

  if (!result.success) {
    throw new Error("Falha ao consultar canais válidos no D1.");
  }

  return result.results ?? [];
}

export async function validStream(
  db: D1Database,
  kv: KVNamespace
): Promise<ValidResult> {
  const cursorValue = await kv.get(CURSOR_KEY);
  let cursor = Number(cursorValue ?? 0);

  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    cursor = 0;
  }

  // Tenta continuar após o último ID processado.
  let channels = await selectChannels(db, cursor);

  // Fim do ciclo: volta ao início e busca o próximo lote.
  if (channels.length === 0 && cursor > 0) {
    cursor = 0;
    channels = await selectChannels(db, 0);
  }

  // Nenhum canal válido para processar.
  if (channels.length === 0) {
    await kv.put(CURSOR_KEY, "0");

    return {
      processedCount: 0,
      invalidatedCount: 0,
      nextCursor: 0,
      completed: true,
    };
  }

  const results: Array<{
    channel: ChannelRecord;
    validation: ValidationResult;
  }> = [];

  // Máximo de 3 canais testados simultaneamente.
  // Evita abrir 9 conexões externas ao mesmo tempo.
  for (
    let i = 0;
    i < channels.length;
    i += MAX_CONCURRENT_CHANNELS
  ) {
    const group = channels.slice(
      i,
      i + MAX_CONCURRENT_CHANNELS
    );

    const groupResults = await Promise.all(
      group.map(async (channel) => ({
        channel,
        validation: await validateStream(channel),
      }))
    );

    results.push(...groupResults);
  }

  const failed = results.filter(
    (result) => !result.validation.valid
  );

  // Uma chamada D1 em lote para marcar os canais que falharam.
  // Falhas temporárias também são marcadas active = 0,
  // conforme a regra definida para este serviço.
  if (failed.length > 0) {
    const statements = failed.map(({ channel, validation }) => {
      console.warn(
        `[valid] Canal ${channel.id_channel} inválido:`,
        validation.reason,
        `(${validation.requests} requisições)`
      );

      return db
        .prepare(`
          UPDATE "channels-m3u"
          SET active = 0
          WHERE id = ?
            AND active = 1
        `)
        .bind(channel.id);
    });

    const updateResults = await db.batch(statements);

    if (updateResults.some((result) => !result.success)) {
      throw new Error("Falha ao atualizar canais inválidos no D1.");
    }
  }

  // O cursor só avança depois que as atualizações do D1 concluem.
  const nextCursor = channels[channels.length - 1].id;

  await kv.put(CURSOR_KEY, String(nextCursor));

  return {
    processedCount: channels.length,
    invalidatedCount: failed.length,
    nextCursor,
    completed: false,
  };
}
