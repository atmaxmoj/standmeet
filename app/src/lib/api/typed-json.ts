import type { z } from 'zod';

export async function safeJson<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  const raw: unknown = await res.json();
  return schema.parse(raw);
}

export function safeJsonString<T>(raw: string, schema: z.ZodType<T>): T {
  const parsed: unknown = JSON.parse(raw);
  return schema.parse(parsed);
}
