// BundlePanel — install a block, and assemble blocks into bundles.
//
// The owner-facing half of `docs/design/plugin/frontend.md`. Two things live here that
// used to be spread across three screens and an MCP session:
//
//   • **install** — paste a manifest. A block is a directory and a declaration; nothing
//     about installing one should require us to ship a release.
//   • **assemble** — name a group, put blocks in it. A code points at a group, and
//     "what can this code do" becomes that group's list rather than a rule evaluated
//     over global ∧ role ∧ ¬code-deny.
//
// Removing a block is immediate, and the copy says so: there is no draining and no
// grace period (`block-model.md`), so an owner clicking remove is revoking access from
// sessions that are open right now. That is the behaviour they want in a hurry, and the
// one thing they must not be surprised by.

'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { AdminSectionHead } from '@/components/admin/AdminSectionHead';
import { useBundles, type Bundle, type BundlesHook } from '@/lib/admin/use-bundles';
import { useBlocks, type BlockRow } from '@/lib/admin/use-blocks';
import { useAction } from '@/lib/ui/use-action';

export function BundlePanel() {
  const t = useTranslations('adminIntegrations.blocks');
  const bundles = useBundles();
  const blocks = useBlocks();
  const { ensureLoaded } = bundles;
  const blocksLoad = blocks.ensureLoaded;
  useEffect(() => {
    void ensureLoaded();
    void blocksLoad();
  }, [ensureLoaded, blocksLoad]);

  return (
    <div className="space-y-5">
      <InstallPanel hook={bundles} />
      <section
        className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-5"
        data-testid="bundle-panel"
      >
        <span className="ch-tl" /><span className="ch-br" />
        <AdminSectionHead aside={t('bundlesKicker')}>{t('bundlesHeading')}</AdminSectionHead>
        <p className="mt-2 text-sm text-(--color-muted)">{t('bundlesIntro')}</p>
        <NewBundle hook={bundles} />
        <div className="mt-4 space-y-4">
          {bundles.bundles.map((b) => (
            <BundleEditor key={b.name} bundle={b} hook={bundles} rows={blocks.rows} />
          ))}
        </div>
      </section>
    </div>
  );
}

// InstallPanel — the paste box.
//
// A textarea and nothing else on purpose: the manifest IS the block, so a form with a
// field per manifest key would be a second, lossier spelling of the same declaration —
// and it would need editing every time a block gains a field, which is exactly the cost
// this design exists to remove.
function InstallPanel({ hook }: { hook: BundlesHook }) {
  const t = useTranslations('adminIntegrations.blocks');
  const [manifest, setManifest] = useState('');
  const run = useAction();
  return (
    <section
      className="crosshair border border-(--color-rule) rounded-sm bg-(--color-surface)/30 p-5"
      data-testid="block-install-panel"
    >
      <span className="ch-tl" /><span className="ch-br" />
      <AdminSectionHead aside={t('installKicker')}>{t('installHeading')}</AdminSectionHead>
      <p className="mt-2 text-sm text-(--color-muted)">{t('installIntro')}</p>
      <textarea
        data-testid="block-manifest-input"
        value={manifest}
        onChange={(e) => setManifest(e.target.value)}
        spellCheck={false}
        rows={8}
        placeholder={t('installPlaceholder')}
        className="mt-3 w-full mono text-xs p-3 border border-(--color-rule) rounded-sm
                   bg-(--color-bg) text-(--color-ink) resize-y"
      />
      <button
        type="button"
        data-testid="block-install-submit"
        onClick={() => {
          void run(() => hook.install(manifest), { success: t('installedToast') })
            .then(() => setManifest(''));
        }}
        className="mt-3 px-3 py-1.5 mono text-xs border border-(--color-accent)
                   text-(--color-accent) rounded-sm hover:bg-(--color-accent)/10"
      >
        {t('install')}
      </button>
    </section>
  );
}

function NewBundle({ hook }: { hook: BundlesHook }) {
  const t = useTranslations('adminIntegrations.blocks');
  const [name, setName] = useState('');
  const run = useAction();
  return (
    <div className="mt-4 flex items-center gap-2">
      <input
        data-testid="bundle-new-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('bundleNamePlaceholder')}
        className="sm-field-input sm-mono flex-1"
      />
      <button
        type="button"
        data-testid="bundle-new-create"
        onClick={() => {
          void run(() => hook.create(name), { success: t('bundleCreatedToast') })
            .then(() => setName(''));
        }}
        className="px-3 py-1.5 mono text-xs border border-(--color-accent)
                   text-(--color-accent) rounded-sm hover:bg-(--color-accent)/10"
      >
        {t('create')}
      </button>
    </div>
  );
}

function BundleEditor(
  { bundle, hook, rows }: { bundle: Bundle; hook: BundlesHook; rows: readonly BlockRow[] },
) {
  const members = new Set(bundle.blocks);
  return (
    <div
      className="border border-(--color-rule)/60 rounded-sm p-4"
      data-testid={`bundle-editor-${bundle.name}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-xs text-(--color-ink)">{bundle.name}</span>
        <BundleHealth bundle={bundle} />
      </div>
      <ul className="mt-3 space-y-1">
        {bundle.blocks.map((id) => (
          <MemberRow key={id} bundle={bundle.name} id={id} hook={hook} rows={rows} />
        ))}
      </ul>
      <AddableList bundle={bundle.name} hook={hook} rows={rows} members={members} />
    </div>
  );
}

// BundleHealth — the owner's third face of a failure.
//
// Rendered from stored state rather than from anything that happened while this page was
// open: `tests.md` §3 asks for a **persistent** entry, because a toast that appears if
// the owner happens to be looking is not a diagnosis. Absent when nothing failed — an
// always-present "0 problems" badge is noise the eye stops reading, which is how the one
// that matters gets missed.
function BundleHealth({ bundle }: { bundle: Bundle }) {
  return bundle.failures.length === 0 ? null : <Failed bundle={bundle} />;
}

function Failed({ bundle }: { bundle: Bundle }) {
  const t = useTranslations('adminIntegrations.blocks');
  return (
    <div className="w-full mt-2" data-testid={`bundle-health-${bundle.name}`}>
      <p className="mono text-[10px] text-(--color-accent)">
        {t('blocksFailed', { count: bundle.failures.length })}
      </p>
      <ul className="mt-1 space-y-1">
        {bundle.failures.map((f) => (
          <li
            key={f.block_id}
            data-testid={`block-failure-${f.block_id}`}
            className="mono text-[10px] text-(--color-muted) border-l-2
                       border-(--color-accent)/40 pl-2"
          >
            <span className="text-(--color-ink)">{f.title}</span>
            {/* The child's own words. Never shown to a visitor — diagnosis is the
                owner's half, an outcome is the visitor's. */}
            <span className="block break-all opacity-80">{f.stderr}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MemberRow(
  { bundle, id, hook, rows }:
  { bundle: string; id: string; hook: BundlesHook; rows: readonly BlockRow[] },
) {
  const t = useTranslations('adminIntegrations.blocks');
  const run = useAction();
  return (
    <li className="flex items-center gap-2" data-testid={`bundle-member-${id}`}>
      <span className="mono text-[11px] text-(--color-ink) flex-1 truncate">
        {id}
        {carriesNet(id, rows) && (
          <span className="ml-1 text-(--color-accent)">{t('grantNet')}</span>
        )}
      </span>
      <button
        type="button"
        data-testid={`bundle-remove-${id}`}
        onClick={() => {
          void run(() => hook.removeBlock(bundle, id), { success: t('removedToast') });
        }}
        className="mono text-[10px] text-(--color-muted) hover:text-(--color-accent)"
      >
        {t('remove')}
      </button>
    </li>
  );
}

// carriesNet — does this block reach the network.
//
// The argument for making a permission a block at all is that the owner ASSEMBLING it
// can see the permission (`isolation.md`). A block that reaches the network says so
// here; one that does not says nothing, and nothing is the honest rendering of an absent
// grant — omission fails closed, so there is no "net: off" to display.
function carriesNet(id: string, rows: readonly BlockRow[]): boolean {
  return rows.find((r) => r.id === id)?.grants?.includes('net') === true;
}

// AddableList — every block not already in this bundle.
//
// The whole installed set, filtered by membership, so a block installed a moment ago is
// addable without a reload. No search box: the number of blocks an instance has is small
// and the list is the point — an owner assembling a bundle is choosing from what they
// have, not looking something up.
function AddableList(
  { bundle, hook, rows, members }:
  { bundle: string; hook: BundlesHook; rows: readonly BlockRow[]; members: Set<string> },
) {
  const addable = rows.filter((r) => !members.has(r.id));
  return addable.length === 0
    ? null
    : <Addable bundle={bundle} hook={hook} addable={addable} />;
}

function Addable(
  { bundle, hook, addable }:
  { bundle: string; hook: BundlesHook; addable: readonly BlockRow[] },
) {
  const t = useTranslations('adminIntegrations.blocks');
  const run = useAction();
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-(--color-rule)/40 pt-3">
      {addable.map((r) => (
        <button
          key={r.id}
          type="button"
          data-testid={`bundle-add-${r.id}`}
          onClick={() => {
            void run(() => hook.addBlock(bundle, r.id), { success: t('addedToast') });
          }}
          className="mono text-[10px] px-1.5 py-0.5 border border-(--color-rule) rounded-sm
                     text-(--color-muted) hover:text-(--color-accent)
                     hover:border-(--color-accent)/50"
        >
          {t('addBlock', { id: r.id })}
        </button>
      ))}
    </div>
  );
}
