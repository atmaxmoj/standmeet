// use-model-list —— state machine for the "Load models" button. Shared by
// two panels: BYOAIPanel (visitor) + AIProviderPanel (admin owner).
//
// Three UI shapes:
//   1) options == null → text input, with a "Load models" button next to it
//   2) options != null → dropdown <select>, with a "↻" refetch + "type
//      manually" switch back to text input next to it
//   3) loading == true → button shows "loading…" disabled
//
// On failure: the caller passes onError(message) to pop a toast, and
// options stays as-is (still null, or still the previously loaded list).
//
// The network layer is list-models.ts; this only handles state.

import { useCallback, useState } from 'react';

import {
  listModels, listOwnerModels, type ListModelsInput,
} from '@/lib/inference/list-models';

export interface ModelListState {
  readonly options: readonly string[] | null;
  readonly loading: boolean;
}

export interface ModelListHook {
  state: ModelListState;
  load: (input: ListModelsInput) => Promise<void>;
  // loadOwn —— the owner's side: **sends no key**, the server asks upstream
  // with the key it has stored (F-R-11). The visitor side is the reverse
  // (the key travels with the request), so each path gets its own entry
  // point rather than one entry point with a flag.
  loadOwn: () => Promise<void>;
  reset: () => void;
}

export function useModelList(onError: (msg: string) => void): ModelListHook {
  const [options, setOptions] = useState<readonly string[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (input: ListModelsInput): Promise<void> => {
    setLoading(true);
    try {
      const models = await listModels(input);
      setOptions(models);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'list models failed');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  const loadOwn = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setOptions(await listOwnerModels());
    } catch (e) {
      onError(e instanceof Error ? e.message : 'list models failed');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  const reset = useCallback(() => setOptions(null), []);

  return { state: { options, loading }, load, loadOwn, reset };
}
