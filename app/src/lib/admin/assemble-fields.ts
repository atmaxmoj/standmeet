// assemble-fields —— 品类 → 内置协议（calendar=CalDAV，mail=SMTP）的固定凭据字段。归一装配视图
// （AssembleView）用它渲染协议路的表单；openapi 路的字段是从上传 spec 派生的，不在这。

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

// TLS 是纯文本字段（none | starttls | tls），不用 select —— 装配测试一律 .fill() 填值。
const TLS_FIELD: AssembleField = { k: 'tls', label: 'TLS (none | starttls | tls)', default: 'starttls' };

// PROTOCOL_BY_CATEGORY —— 品类的内置协议 + 它的固定凭据字段（admin 填）。
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

// protocolForCategory —— 品类的内置协议规格（未知品类 → undefined）。
export function protocolForCategory(category: string): ProtocolSpec | undefined {
  return PROTOCOL_BY_CATEGORY[category];
}

// fieldDefault —— 字段初值（default > 首个 option > 空）。
export function fieldDefault(field: AssembleField): string {
  return field.default ?? field.options?.[0] ?? '';
}

// seedDefaults —— 字段默认值预置进一个 values map（select 的 default 不触发 onChange，否则提交时丢）。
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
