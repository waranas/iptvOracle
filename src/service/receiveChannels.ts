
interface ReceiveChannelsControls {
  reduce?: boolean;
  swapChannel_id?: boolean;
}

interface NormalChannel {
  id: number;
  id_channel: number;
  name: string;
  url: string;
  "tvg-id": string;
  "group-title": string;
  font_ref: number;
  album: string;
  variant_refs: string;
  active: number | boolean;
  date_registry: number;
}

interface ReducedChannel {
  id: number;
  name: string;
  url: string;
  "tvg-id": string;
  date_registry: number;
}

const NORMAL_COLUMNS = [
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
];

const REDUCED_COLUMNS = [
  "id",
  "name",
  "url",
  "tvg-id",
  "date_registry",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value)
  );
}

function hasExactColumns(
  record: Record<string, unknown>,
  columns: string[]
): boolean {
  const keys = Object.keys(record);

  return (
    keys.length === columns.length &&
    columns.every((column) =>
      Object.prototype.hasOwnProperty.call(record, column)
    )
  );
}

function isValidUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

function validateBaseChannel(
  channel: Record<string, unknown>
): boolean {
  return (
    isInteger(channel.id) &&
    channel.id > 0 &&
    typeof channel.name === "string" &&
    channel.name.length > 0 &&
    isValidUrl(channel.url) &&
    typeof channel["tvg-id"] === "string" &&
    channel["tvg-id"].length > 0 &&
    isInteger(channel.date_registry) &&
    channel.date_registry >= 0
  );
}

function validateReducedChannel(
  channel: Record<string, unknown>
): boolean {
  return (
    hasExactColumns(channel, REDUCED_COLUMNS) &&
    validateBaseChannel(channel)
  );
}

function validateNormalChannel(
  channel: Record<string, unknown>
): boolean {
  if (
    !hasExactColumns(channel, NORMAL_COLUMNS) ||
    !validateBaseChannel(channel)
  ) {
    return false;
  }

  if (
    !isInteger(channel.id_channel) ||
    channel.id_channel <= 0 ||
    typeof channel["group-title"] !== "string" ||
    !isInteger(channel.font_ref) ||
    typeof channel.album !== "string" ||
    typeof channel.variant_refs !== "string" ||
    !(
      channel.active === true ||
      channel.active === false ||
      channel.active === 0 ||
      channel.active === 1
    )
  ) {
    return false;
  }

  try {
    return Array.isArray(JSON.parse(channel.variant_refs));
  } catch {
    return false;
  }
}

export async function receiveChannels(
  db: D1Database,
  kv: KVNamespace,
  data: unknown,
  controls: ReceiveChannelsControls = {}
) {
  const reduce = controls.reduce ?? false;
  const swapChannel_id = controls.swapChannel_id ?? true;

  if (typeof reduce !== "boolean") {
    throw new Error("controls.reduce deve ser boolean.");
  }

  if (typeof swapChannel_id !== "boolean") {
    throw new Error("controls.swapChannel_id deve ser boolean.");
  }

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Nenhum canal foi recebido.");
  }

  if (data.length > 90) {
    throw new Error("O limite máximo por requisição é de 90 canais.");
  }

  const channels = data as Record<string, unknown>[];

  // =====================================================
  // 1. VALIDAR TODOS OS REGISTROS
  // =====================================================

  const tvgIds = new Set<string>();

  for (const [index, channel] of channels.entries()) {
    if (!isObject(channel)) {
      throw new Error(`Registro ${index + 1} inválido.`);
    }

    const valid = reduce
      ? validateReducedChannel(channel)
      : validateNormalChannel(channel);

    if (!valid) {
      throw new Error(
        `Estrutura inválida no registro ${index + 1}.`
      );
    }

    const tvgId = channel["tvg-id"] as string;

    if (tvgIds.has(tvgId)) {
      throw new Error(`tvg-id duplicado: ${tvgId}`);
    }

    tvgIds.add(tvgId);
  }

  // =====================================================
  // 2. DEFINIR SE OS IDS SERÃO ALTERADOS
  // =====================================================

  // No modo reduzido, o id_channel não é recebido.
  // Portanto, sempre será necessário gerar um novo ID.
  const shouldSwapChannelId = reduce || swapChannel_id;

  let lastId: number | null = null;

  if (shouldSwapChannelId) {
    const lastIdValue = await kv.get("last_channel_id");

    if (lastIdValue === null) {
      throw new Error(
        "KV last_channel_id não encontrada."
      );
    }

    lastId = Number(lastIdValue);

    if (!Number.isSafeInteger(lastId) || lastId < 0) {
      throw new Error(
        "Valor inválido na KV last_channel_id."
      );
    }
  }

  // =====================================================
  // 3. PREPARAR REGISTROS
  // =====================================================

  const statements: D1PreparedStatement[] = [];

  for (const channel of channels) {
    let channelId: number;

    if (shouldSwapChannelId) {
      lastId!++;

      if (!Number.isSafeInteger(lastId)) {
        throw new Error("Limite de IDs inteiros atingido.");
      }
      if (lastId === null) {
          throw new Error("ID inicial não foi definido.");
        }
      channelId = lastId;
    } else {
      const item = channel as unknown as NormalChannel;
      channelId = item.id_channel;
    }

    if (reduce) {
      const item = channel as unknown as ReducedChannel;

      statements.push(
        db.prepare(`
          INSERT INTO "channels-m3u" (
            "id_channel",
            "name",
            "url",
            "tvg-id",
            "group-title",
            "font_ref",
            "album",
            "variant_refs",
            "active",
            "date_registry"
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

          ON CONFLICT ("tvg-id") DO UPDATE SET
            "id_channel" = excluded."id_channel",
            "name" = excluded."name",
            "url" = excluded."url",
            "group-title" = '',
            "font_ref" = 0,
            "album" = '',
            "variant_refs" = '[]',
            "active" = 0,
            "date_registry" = excluded."date_registry"
        `).bind(
          channelId,
          item.name,
          item.url,
          item["tvg-id"],
          "",
          0,
          "",
          "[]",
          0,
          item.date_registry
        )
      );
    } else {
      const item = channel as unknown as NormalChannel;

      statements.push(
        db.prepare(`
          INSERT INTO "channels-m3u" (
            "id_channel",
            "name",
            "url",
            "tvg-id",
            "group-title",
            "font_ref",
            "album",
            "variant_refs",
            "active",
            "date_registry"
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

          ON CONFLICT ("tvg-id") DO UPDATE SET
            "id_channel" = excluded."id_channel",
            "name" = excluded."name",
            "url" = excluded."url",
            "group-title" = excluded."group-title",
            "font_ref" = excluded."font_ref",
            "album" = excluded."album",
            "variant_refs" = excluded."variant_refs",
            "active" = excluded."active",
            "date_registry" = excluded."date_registry"
        `).bind(
          channelId,
          item.name,
          item.url,
          item["tvg-id"],
          item["group-title"],
          item.font_ref,
          item.album,
          item.variant_refs,
          Number(item.active),
          item.date_registry
        )
      );
    }
  }

  // =====================================================
  // 4. SALVAR TODOS OS REGISTROS NO D1
  // =====================================================

  const results = await db.batch(statements);

  const saved = results.reduce(
    (total, result) =>
      total + (result.meta.changes ?? 0),
    0
  );

  if (saved !== channels.length) {
    throw new Error(
      `Recebimento incompleto: ${saved} de ${channels.length} registros salvos.`
    );
  }

  // =====================================================
  // 5. ATUALIZAR ÚLTIMO ID NA KV
  // =====================================================

  if (shouldSwapChannelId && lastId !== null) {
    await kv.put("last_channel_id", String(lastId));
  }

  // =====================================================
  // 6. RETORNAR RESULTADO
  // =====================================================

  return {
    mode: reduce ? "reduced" : "normal",
    received: channels.length,
    saved,
    last_id_channel: lastId,
  };
}
