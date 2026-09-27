// WebhooksSection —— /admin/webhooks. Where the owner's changes are announced to other sites: an
// endpoint list, a create form (URL + event types), the signing secret shown once, and the open
// endpoint's delivery log with send-test and re-deliver (docs/design/event-bus-outbox-webhooks.md,
// *Webhook endpoints*). Every display decision is made in use-webhooks; this file places strings.

'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { ListPane } from '@/components/admin/ListPane';
import { SectionHeader } from '@/components/admin/SectionHeader';
import {
  useWebhooks, webhooksStore, deliveryRowView, endpointRowView, toggleType,
  type Delivery, type Endpoint, type EventType,
} from '@/lib/admin/use-webhooks';
import type { ResourceStatus } from '@/lib/state/status';
import { useEffectErrorToast } from '@/lib/ui/toast';
import { useAction } from '@/lib/ui/use-action';

const LABEL = 'mono text-[10.5px] tracking-[0.16em] uppercase text-(--color-muted)';
const SMALL_BTN = 'sm-btn sm-btn-outline sm-btn-sm';

export function WebhooksSection() {
  const t = useTranslations('adminShell.webhooks');
  const hook = useWebhooks();
  useEffectErrorToast(hook.error);
  return (
    <>
      <SectionHeader kicker={t('kicker')} slug="webhooks" />
      <p className="reading-tight text-(--color-muted) mb-7 text-[15px] max-w-[54em]">{t('intro')}</p>
      <CreateForm types={hook.types} />
      {hook.secret !== null && <SecretReveal secret={hook.secret} />}
      <AdminSectionHead className="mb-3 mt-9">{t('endpointsHeading')}</AdminSectionHead>
      <ListPane
        status={hook.endpoints.status}
        count={hook.endpoints.data.length}
        empty={<p className="text-(--color-muted) text-[15px] reading-tight">{t('empty')}</p>}
      >
        <ul className="border border-(--color-rule) rounded-[3px] divide-y divide-(--color-rule)">
          {hook.endpoints.data.map((e) => <EndpointRow key={e.id} endpoint={e} />)}
        </ul>
      </ListPane>
      {hook.open !== null && <DeliveryLog deliveries={hook.deliveries} />}
    </>
  );
}

function CreateForm({ types }: { types: EventType[] }) {
  const t = useTranslations('adminShell.webhooks');
  const run = useAction();
  const [url, setURL] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const submit = useCallback(() => run(async () => {
    await webhooksStore.getState().create(url.trim(), picked);
    setURL('');
    setPicked([]);
  }), [run, url, picked]);
  return (
    <div className="border border-(--color-rule) rounded-[3px] p-4 flex flex-col gap-4 max-w-[54em]">
      <label className="flex flex-col gap-1">
        <span className={LABEL}>{t('url')}</span>
        <input
          data-testid="webhook-url" className="sm-field-input" type="url" value={url}
          placeholder="https://example.com/hooks/standmeet" onChange={(e) => setURL(e.target.value)}
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className={`${LABEL} mb-2`}>{t('eventTypes')}</legend>
        {types.map((ty) => (
          <label key={ty.type} className="flex items-baseline gap-3 text-[13.5px] reading-tight">
            <input
              type="checkbox" data-testid="webhook-event-type" data-type={ty.type}
              checked={picked.includes(ty.type)}
              onChange={(e) => setPicked((p) => toggleType(p, ty.type, e.target.checked))}
            />
            <span className="mono text-[12px] text-(--color-ink)">{ty.type}</span>
            <span className="text-(--color-muted)">{ty.description}</span>
          </label>
        ))}
      </fieldset>
      <div>
        <button type="button" data-testid="webhook-create" onClick={submit} className="sm-btn sm-btn-solid sm-btn-sm">
          {t('create')}
        </button>
      </div>
    </div>
  );
}

function SecretReveal({ secret }: { secret: string }) {
  const t = useTranslations('adminShell.webhooks');
  return (
    <div className="border border-(--color-accent) rounded-[3px] p-4 mt-4 max-w-[54em]">
      <div className={LABEL}>{t('secretLabel')}</div>
      <code data-testid="webhook-secret" className="mono text-[12.5px] text-(--color-ink) break-all block my-2">{secret}</code>
      <p className="reading-tight italic text-(--color-muted) text-[13px]">{t('secretOnce')}</p>
    </div>
  );
}

function EndpointRow({ endpoint }: { endpoint: Endpoint }) {
  const t = useTranslations('adminShell.webhooks');
  const run = useAction();
  const v = endpointRowView(endpoint);
  const s = webhooksStore.getState;
  return (
    <li data-testid="webhook-row" data-endpoint-id={v.id} data-status={v.status} className="px-3 py-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="mono text-[12px] text-(--color-ink) break-all flex-1 min-w-0">{v.url}</span>
        <span className="mono text-[11px] text-(--color-accent)">{t(`status.${v.status}`)}</span>
        {v.reason !== '' && <span className="text-[12.5px] italic text-(--color-muted)">{v.reason}</span>}
      </div>
      <div className="mono text-[11px] text-(--color-muted)">{v.types}</div>
      <div className="flex flex-wrap gap-3">
        <button type="button" data-testid="webhook-open" className={SMALL_BTN} onClick={() => run(() => s().openLog(v.id))}>
          {t('open')}
        </button>
        <button
          type="button" data-testid="webhook-send-test" className={SMALL_BTN}
          onClick={() => run(() => s().sendTest(v.id), { success: t('testQueued') })}
        >
          {t('sendTest')}
        </button>
        <button
          type="button" data-testid="webhook-toggle" className={SMALL_BTN}
          onClick={() => run(() => s().setEnabled(v.id, !endpoint.enabled))}
        >
          {endpoint.enabled ? t('disable') : t('enable')}
        </button>
        <button type="button" data-testid="webhook-rotate" className={SMALL_BTN} onClick={() => run(() => s().rotate(v.id))}>
          {t('rotate')}
        </button>
        <button type="button" data-testid="webhook-delete" className="sm-btn sm-btn-ghost sm-btn-sm" onClick={() => run(() => s().remove(v.id))}>
          {t('delete')}
        </button>
      </div>
    </li>
  );
}

function DeliveryLog({ deliveries }: { deliveries: { status: ResourceStatus; data: Delivery[] } }) {
  const t = useTranslations('adminShell.webhooks');
  const run = useAction();
  return (
    <div data-testid="webhook-log" className="mt-9">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <AdminSectionHead>{t('logHeading')}</AdminSectionHead>
        <button
          type="button" data-testid="webhook-redeliver-all" className={SMALL_BTN}
          onClick={() => run(() => webhooksStore.getState().redeliverAll(), { success: t('redelivered') })}
        >
          {t('redeliverAll')}
        </button>
      </div>
      <ListPane
        status={deliveries.status}
        count={deliveries.data.length}
        empty={<p className="text-(--color-muted) text-[15px] reading-tight">{t('logEmpty')}</p>}
      >
        <DeliveryRows deliveries={deliveries.data} />
      </ListPane>
    </div>
  );
}

function DeliveryRows({ deliveries }: { deliveries: Delivery[] }) {
  const t = useTranslations('adminShell.webhooks');
  return (
    <ul className="border border-(--color-rule) rounded-[3px] divide-y divide-(--color-rule)">
      {deliveries.map((d) => {
        const v = deliveryRowView(d);
        return (
          <li key={v.key} data-testid="webhook-delivery" data-job-id={v.key} data-state={v.state} data-attempt={v.attempt} className="px-3 py-2 flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-4">
              <span className="mono text-[11px] text-(--color-faint)">#{v.key}</span>
              <span className="mono text-[11px] text-(--color-ink) flex-1 min-w-0 truncate">{v.event}</span>
              <span className="mono text-[11px] text-(--color-accent)">{v.state}</span>
              <span className="mono text-[11px] text-(--color-muted)">{t('attemptN', { n: v.attempt })}</span>
              <span className="mono text-[11px] text-(--color-muted)">{v.when}</span>
              <span data-testid="webhook-delivery-job" className="mono text-[11px]">
                <Link href={v.jobHref} className="text-(--color-muted) hover:text-(--color-accent) underline">
                  {t('openJob')}
                </Link>
              </span>
            </div>
            {v.lastError !== '' && <span className="mono text-[11px] text-(--color-accent) break-all">{v.lastError}</span>}
          </li>
        );
      })}
    </ul>
  );
}
