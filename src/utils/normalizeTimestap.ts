/**
 * Normaliza o timestamp recebido.
 *
 * Valores numéricos são interpretados como Unix timestamp
 * em milissegundos.
 */
export function normalizeTimestamp(timestamp: string | number | Date): string {
  const date =
    timestamp instanceof Date
      ? timestamp
      : new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    throw new Error(
      "[deleteOldChannels] Timestamp inválido."
    );
  }

  return date.toISOString();
}
