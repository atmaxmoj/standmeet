// provider-form.ts —— shared form-state derivation logic for the BYOAI
// panel + the admin AIProviderPanel. Both components follow the same rule
// ("pick provider → preset default fills endpoint; keep it if the user has
// edited it"); this is that rule factored out, so the components only
// handle rendering.
//
// **The model field is not auto-filled**: the preset table has no
// defaultModel anymore, so switching provider only resets endpoint. model
// is left for the user to type themselves (or click "Load models" to pull
// the real list). This change avoids silently pointing at a stale /
// unavailable default model.
//
// Design choice: the state shape is not tied to the InferencePreset type
// from lib/inference/presets.ts — on the admin side, the preset is a
// fetched server view (AIProviderPresetView) with different field names
// (base_url vs baseUrl). This goes through a minimal PresetDefaults
// abstraction instead, and each side adapts its own preset shape to it.

export interface PresetDefaults {
  endpoint: string;
}

// EMPTY_DEFAULTS —— fallback for when no preset is found (e.g. custom); all
// fields empty strings.
export const EMPTY_DEFAULTS: PresetDefaults = { endpoint: '' };

// ProviderFormState —— minimal state for a provider-switching form.
// lastDefaults is "the preset default last auto-filled", used to detect
// whether the user manually edited endpoint. model is always user input and
// never participates in the "auto-refill" logic.
export interface ProviderFormState {
  provider: string;
  endpoint: string;
  model: string;
  lastDefaults: PresetDefaults;
}

// initialProviderForm —— initializes the form: pours the current provider's
// preset default endpoint in, and records it into lastDefaults too. model
// always starts empty (user types it, or Load models fills it).
export function initialProviderForm(
  provider: string, defaults: PresetDefaults,
): ProviderFormState {
  return {
    provider,
    endpoint: defaults.endpoint,
    model: '',
    lastDefaults: { endpoint: defaults.endpoint },
  };
}

// seededProviderForm —— seeds the form from the SoT (the owner's saved
// endpoint/model returned by /me), so the owner sees their last-saved
// values when reopening settings, not the preset default. lastDefaults
// still uses the preset default, for detecting whether the owner has edited
// endpoint when switching provider (#33).
export function seededProviderForm(
  provider: string, endpoint: string, model: string, presetEndpoint: string,
): ProviderFormState {
  return {
    provider,
    endpoint,
    model,
    lastDefaults: { endpoint: presetEndpoint },
  };
}

// switchProvider —— the state transition when picking a provider:
//   - if the user edited endpoint (prev value != the last auto-filled
//     default), keep the user value
//   - if not edited, refill with the new preset default endpoint
//   - lastDefaults always updates to the new preset default endpoint (the
//     baseline for the next switch's comparison)
//   - model is cleared outright — once provider changes, the previous model
//     id is almost certainly no longer valid
export function switchProvider(
  prev: ProviderFormState, provider: string, next: PresetDefaults,
): ProviderFormState {
  const endpoint = pickEndpoint(prev, next);
  return {
    provider, endpoint, model: '',
    lastDefaults: { endpoint: next.endpoint },
  };
}

function pickEndpoint(prev: ProviderFormState, next: PresetDefaults): string {
  return prev.endpoint === prev.lastDefaults.endpoint ? next.endpoint : prev.endpoint;
}

// setEndpoint / setModel —— single-field updates, so components don't have
// to hand-write a spread.
export function setEndpoint(prev: ProviderFormState, v: string): ProviderFormState {
  return { ...prev, endpoint: v };
}

export function setModel(prev: ProviderFormState, v: string): ProviderFormState {
  return { ...prev, model: v };
}
