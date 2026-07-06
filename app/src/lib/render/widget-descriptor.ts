// widget-descriptor.ts —— ` ```standmeet-widget ` 块内 JSON descriptor 的解析 + 校验(usecase 层)。
// src 必须是 URL;height 有界;sandbox 可选覆盖。畸形 → null(块降级,不渲染 iframe)。

import { z } from 'zod';

const DescSchema = z.object({
  src: z.string().url(),
  height: z.number().int().positive().max(2000).optional(),
  sandbox: z.string().optional(),
});

type WidgetDescriptor = z.infer<typeof DescSchema>;

// ResolvedWidget —— 默认值填好的 descriptor,组件直接用(免在 presentation 层写 `??`)。
export interface ResolvedWidget {
  src: string;
  height: number;
  sandbox: string;
}

export function parseWidgetDescriptor(source: string): ResolvedWidget | null {
  const result = DescSchema.safeParse(tryParseJSON(source));
  return result.success ? resolveDefaults(result.data) : null;
}

// resolveDefaults —— height 320;sandbox 最小权限 'allow-scripts'(不给 allow-same-origin,免 sandbox 自解除)。
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
