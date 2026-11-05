import { cleanNullValues } from "waranas";

export function removeEmptyChannelsProperty(
  channel: Record<string, unknown>,
): Record<string, unknown> {
  const cleaned = cleanNullValues(channel);

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(cleaned)) {
    // Valores internos que representam ausência de informação
    if (value === "-") {
      continue;
    }

    if (
      Array.isArray(value) &&
      value.length === 0
    ) {
      continue;
    }

    if (
      typeof value === "string" &&
      value.trim() === ""
    ) {
      continue;
    }

    result[key] = value;
  }

  return result;
}
