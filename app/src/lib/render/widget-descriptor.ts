// widget-descriptor.ts — parsing + validation (usecase layer) for the JSON descriptor
// inside a ` ```standmeet-widget ` block.
// src must be a URL; height is bounded; sandbox is an optional override. Malformed → null
// (block degrades gracefully, no iframe rendered).

import { z } from 'zod';

const DescSchema = z.object({
  src: z.string().url(),
  height: z.number().int().positive().max(2000).optional(),
  sandbox: z.string().optional(),
});

type WidgetDescriptor = z.infer<typeof DescSchema>;

// ResolvedWidget — descriptor with defaults filled in, ready for the component to use
// directly (avoids writing `??` in the presentation layer).
export interface ResolvedWidget {
  src: string;
  height: number;
  sandbox: string;
}

export function parseWidgetDescriptor(source: string): ResolvedWidget | null {
  const result = DescSchema.safeParse(tryParseJSON(source));
  return result.success ? resolveDefaults(result.data) : null;
}

// resolveDefaults — height defaults to 320; sandbox defaults to the least-privilege
// 'allow-scripts' (no allow-same-origin, so the sandbox can't self-lift).
function resolveDefaults(d: WidgetDescriptor): ResolvedWidget {
  return { src: d.src, height: d.height ?? 320, sandbox: d.sandbox ?? 'allow-scripts' };
}

function tryParseJSON(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}
