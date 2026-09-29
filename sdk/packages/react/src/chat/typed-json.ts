import type { z } from 'zod';

// safeJsonString —— parse a stored JSON string against its schema; a malformed blob throws.
export function safeJsonString<T>(raw: string, schema: z.ZodType<T>): T {
  const parsed: unknown = JSON.parse(raw);
  return schema.parse(parsed);
}
