// GateWidget —— the access CTA: a distinct block that clicks through to /gate, where a visitor
// enters an access code, brings their own key (BYOAI), or requests access. Separate from the
// AgentWidget on purpose — this is "manage access", not "ask a question".
//
// Drop-in: `<GateWidget />`. Optional `label` / `sublabel` override the copy.

'use client';

import React from 'react';

export interface GateWidgetProps {
  readonly label?: string;
  readonly sublabel?: string;
}

export function GateWidget({ label, sublabel }: GateWidgetProps): React.ReactElement {
  return (
    <a
      href="/gate"
      data-testid="gate-widget"
      className="group block border border-(--color-rule) hover:border-(--color-accent) transition-colors rounded-[3px] px-5 py-4 no-underline"
    >
      <div className="mono text-[10px] tracking-[0.22em] uppercase text-(--color-faint) group-hover:text-(--color-accent) transition-colors mb-1">
        access
      </div>
      <div className="font-serif text-(--color-ink) text-[18px] leading-[1.35]">
        {label ?? 'Have a code, or want in?'}
      </div>
      <div className="mono text-[11px] text-(--color-muted) mt-1 group-hover:text-(--color-accent) transition-colors">
        {sublabel ?? 'enter a code · bring your own key · request access ↗'}
      </div>
    </a>
  );
}
