// use-presets —— fetches the provider preset list
// (GET /admin/ai-provider/presets) once.
//
// Two surfaces use it: the default form, and the new-row form in the
// provider table. Returns null = not fetched yet (the caller shows a
// skeleton for this); on failure it toasts and stays null — with no preset
// list there's no way to pick a provider.

'use client';

import { useEffect, useState } from 'react';

import { fetchAIProviderPresets, type AIProviderPresetView } from '@/lib/api/admin';
import { useEffectErrorToast } from '@/lib/ui/toast';

export function usePresets(): readonly AIProviderPresetView[] | null {
  const [presets, setPresets] = useState<AIProviderPresetView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetchAIProviderPresets()
      .then((list) => setPresets(list))
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : 'failed to load presets');
      });
  }, []);
  useEffectErrorToast(err);
  return presets;
}

// endpointForPreset —— the base URL to fill in when a preset is selected
// (missing from the table = empty string, owner types it by hand).
export function endpointForPreset(
  name: string, presets: readonly AIProviderPresetView[],
): string {
  return presets.find((p) => p.name === name)?.base_url ?? '';
}
