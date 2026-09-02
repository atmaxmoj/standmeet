// assemble-fields —— fixed credential fields for the category → built-in
// protocol mapping (calendar=CalDAV, mail=SMTP). The unified assemble view
// (AssembleView) uses this to render the protocol-path form; the openapi
// path's fields are derived from an uploaded spec and don't live here.

export interface AssembleField {
  k: string;
  label: string;
  secret?: boolean;
  options?: readonly string[];
  default?: string;
}

export interface ProtocolSpec {
  protocol: string; // "caldav" | "smtp"
  fields: readonly AssembleField[];
}

// TLS is a plain text field (none | starttls | tls), not a select — assemble tests always fill it with .fill().
const TLS_FIELD: AssembleField = { k: 'tls', label: 'TLS (none | starttls | tls)', default: 'starttls' };

// PROTOCOL_BY_CATEGORY —— a category's built-in protocol + its fixed credential fields (filled in by admin).
export const PROTOCOL_BY_CATEGORY: Record<string, ProtocolSpec> = {
  calendar: {
    protocol: 'caldav',
    fields: [
      { k: 'url', label: 'CalDAV URL' },
      { k: 'username', label: 'Username' },
      { k: 'password', label: 'Password', secret: true },
      TLS_FIELD,
    ],
  },
  mail: {
    protocol: 'smtp',
    fields: [
      { k: 'host', label: 'Host' },
      { k: 'port', label: 'Port', default: '587' },
      { k: 'username', label: 'Username' },
      { k: 'password', label: 'Password', secret: true },
      { k: 'from', label: 'From address' },
      TLS_FIELD,
    ],
  },
};

// protocolForCategory —— a category's built-in protocol spec (unknown category → undefined).
export function protocolForCategory(category: string): ProtocolSpec | undefined {
  return PROTOCOL_BY_CATEGORY[category];
}

// fieldDefault —— the field's initial value (default > first option > empty).
export function fieldDefault(field: AssembleField): string {
  return field.default ?? field.options?.[0] ?? '';
}

// seedDefaults —— pre-seeds field defaults into a values map (a select's default doesn't fire onChange, so it would otherwise be lost on submit).
export function seedDefaults(fields: readonly AssembleField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const d = f.default ?? f.options?.[0];
    if (d !== undefined && d !== '') {
      out[f.k] = d;
    }
  }
  return out;
}
