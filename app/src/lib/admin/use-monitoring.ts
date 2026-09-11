// use-monitoring —— the owner's traffic-collection master switch (monitor.md §8).
//
// Reads the current state from the shared /me sessionStore (settings.monitoring_enabled), and
// flips it with PUT /api/admin/monitoring. Saves on flip — this is a switch, not a form, so there
// is no separate Save button; the toggle IS the action. The response is the whole settings
// envelope, which refreshes sessionStore so every reader of /me sees the new value.

import { useCallback, useState } from 'react';

import { adminAPI, SettingsViewSchema, type MonitoringUpdateInput } from '@/lib/api/admin';
import { sessionStore } from '@/lib/admin/use-admin-session';
import { useResource } from '@/lib/state/create-resource-store';

export interface MonitoringSwitch {
  enabled: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  toggle: () => void;
}

export function useMonitoringSwitch(): MonitoringSwitch {
  const session = useResource(sessionStore);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The current value comes straight from /me (defaulting to on, matching the column default), so
  // there is no second copy of the state to drift: the switch shows what the last save persisted.
  const enabled = session.data?.settings.monitoring_enabled ?? true;

  const toggle = useCallback(() => {
    void save(!enabled, setSaving, setError);
  }, [enabled]);

  return {
    enabled,
    loading: session.status === 'idle' || session.status === 'loading',
    saving,
    error: error ?? session.error,
    toggle,
  };
}

async function save(
  next: boolean, setSaving: (b: boolean) => void, setErr: (m: string | null) => void,
): Promise<void> {
  setSaving(true);
  setErr(null);
  try {
    const body: MonitoringUpdateInput = { enabled: next };
    // monitoring.set returns the settings envelope verbatim (ai + byoai + monitoring_enabled), not
    // a MeView — parse it as such. The value the panel shows comes from the sessionStore refresh
    // below, so the response is only validated, not read.
    await adminAPI.put('/monitoring', body, SettingsViewSchema);
    await sessionStore.getState().refresh();
  } catch (e) {
    setErr(e instanceof Error ? e.message : 'save failed');
  } finally {
    setSaving(false);
  }
}
