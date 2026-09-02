// CorpusAssetsPanel —— the assets section for one corpus entry: pick a file and
// upload it, see what's already attached, insert into body, set as cover, remove.
//
// This is the owner's only way to touch assets from the panel. Before this
// existed, "every genre can carry assets" was done on the backend, rendered on
// the visitor page, and green in e2e — while the owner had zero entry point in
// the UI. A capability only an AI can invoke is, to whoever's on the panel,
// as good as nonexistent.
//
// Every row states **filename + real byte count**: after uploading, those are
// the only two things the owner can check "is what went up the file I picked".
// A bare "uploaded" is not a receipt.

'use client';

import { useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { FilePicker } from '@/components/admin/atoms/FilePicker';
import { SelectField } from '@/components/atoms/SelectField';
import {
  clearFileInput, formatBytes, useCorpusAssets,
  type CorpusAsset, type CorpusAssetsHook,
} from '@/lib/admin/use-corpus-assets';
import { useReportError } from '@/lib/ui/use-report-error';

export interface CorpusAssetsPanelProps {
  genre: string;
  entryID: string;
  testidPrefix: string;
  // insertIntoBody —— write a `standmeet-asset:<id>` reference into the body.
  // Body state lives on the form side, so this just sends out a string and
  // never touches body itself.
  insertIntoBody: (markdown: string) => void;
  // dropFromBody —— when an asset is removed, also remove its reference from
  // the body (F-L-50). **Pairs with insertIntoBody**: whatever can be inserted
  // into the body must also be retractable from it, otherwise "delete" only
  // deletes half, and the remaining half is visible only to visitors.
  dropFromBody: (assetID: string) => void;
  // The cover is **form state**, not a request fired from here — a standalone
  // PATCH would wipe out the body.
  onSetCover: (assetID: string) => void;
  coverAssetID: string;
}

export function CorpusAssetsPanel(props: CorpusAssetsPanelProps) {
  const t = useTranslations('adminCorpus.assets');
  const media = useCorpusAssets(props.genre, props.entryID);
  return (
    <div
      className="space-y-2 border-t border-(--color-rule) pt-3"
      data-testid={`${props.testidPrefix}-assets`}
    >
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block">
        {t('heading')}
      </span>
      <UploadRow media={media} testid={props.testidPrefix} />
      {media.assets.length === 0 ? (
        <p className="mono text-[10.5px] text-(--color-faint)" data-testid={`${props.testidPrefix}-assets-empty`}>
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-1">
          {media.assets.map((a) => (
            <AssetRow
              key={a.asset_id} asset={a} media={media} props={props}
              isCover={props.coverAssetID === a.asset_id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function UploadRow({ media, testid }: { media: CorpusAssetsHook; testid: string }) {
  const t = useTranslations('adminCorpus.assets');
  const [kind, setKind] = useState('image');
  const inputRef = useRef<HTMLInputElement>(null);
  const report = useReportError();
  const onPick = (file: File | undefined) => {
    void media.uploadPicked(file, kind)
      .catch((e: unknown) => { report(e); })
      .finally(() => { clearFileInput(inputRef.current); });
  };
  return (
    <div className="flex items-baseline gap-2">
      <SelectField
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        testid={`${testid}-asset-kind`}
        className="shrink-0"
        mono
      >
        <option value="image">{t('kindImage')}</option>
        <option value="attachment">{t('kindAttachment')}</option>
      </SelectField>
      <FilePicker
        label={t('choose')}
        testid={`${testid}-asset-input`}
        disabled={media.busy}
        inputRef={inputRef}
        onPick={(files) => onPick(files?.[0])}
      />
    </div>
  );
}

function AssetRow(
  { asset, media, props, isCover }: {
    asset: CorpusAsset;
    media: CorpusAssetsHook;
    props: CorpusAssetsPanelProps;
    isCover: boolean;
  },
) {
  const t = useTranslations('adminCorpus.assets');
  const report = useReportError();
  return (
    <li
      className="flex items-baseline gap-3 mono text-[11px]"
      data-testid={`${props.testidPrefix}-asset-row-${asset.asset_id}`}
    >
      <span className="text-(--color-ink) truncate max-w-[16rem]">{asset.original_filename}</span>
      <span className="text-(--color-faint)">{formatBytes(asset.size_bytes)}</span>
      <span className="text-(--color-faint)">{asset.kind}</span>
      {/* This marker has its own testid: another button's label in this row also
          contains "cover", so an assertion that finds it by text would still pass
          after the cover is unset ([[assertion-that-cannot-fail]]). */}
      {isCover ? (
        <span
          className="text-(--color-accent)"
          data-testid={`${props.testidPrefix}-asset-is-cover-${asset.asset_id}`}
        >
          {t('isCover')}
        </span>
      ) : null}
      <BodyBoundBtns asset={asset} props={props} isCover={isCover} />
      <RowBtn
        label={t('remove')}
        testid={`${props.testidPrefix}-asset-remove-${asset.asset_id}`}
        onClick={() => {
          void media.remove(asset.asset_id)
            // Only touch the body once the delete actually succeeds: if the request
            // fails, the body must stay untouched (otherwise the owner could save a
            // draft that's out of sync with the server).
            .then(() => { props.dropFromBody(asset.asset_id); })
            .catch((e: unknown) => { report(e); });
        }}
      />
    </li>
  );
}

// BodyBoundBtns —— the two actions that **mutate body / form state**.
//
// The cover button is a **toggle**: when it's already the cover, it reads
// "unset cover" and sends an empty string. It used to be one-directional
// ("set as cover") only — once set, the only way to undo it was deleting the
// whole asset (same family as F-L-38(a)).
function BodyBoundBtns(
  { asset, props, isCover }: {
    asset: CorpusAsset; props: CorpusAssetsPanelProps; isCover: boolean;
  },
) {
  const t = useTranslations('adminCorpus.assets');
  return (
    <>
      <RowBtn
        label={t('insert')}
        testid={`${props.testidPrefix}-asset-insert-${asset.asset_id}`}
        onClick={() => { props.insertIntoBody(assetMarkdown(asset)); }}
      />
      {/* The cover toggle is **image-only** (F-L-58). Hero is a picture, and a PDF
          can't stand in for one — yet clicking it on a real instance used to be
          accepted anyway: a vermillion `cover` badge appeared on the row, the
          button flipped to `stop using as cover`, and COVER LINE (overlaying a
          title line onto a PDF) followed right after, with no pushback at all.
          The check here uses **the same condition** as `assetMarkdown` below
          (`kind === 'image'`) — the two buttons on one screen each judging it
          separately is exactly why this was missed in the first place. */}
      {asset.kind === 'image' ? (
        <RowBtn
          label={isCover ? t('unsetCover') : t('setCover')}
          testid={`${props.testidPrefix}-asset-cover-${asset.asset_id}`}
          onClick={() => { props.onSetCover(isCover ? '' : asset.asset_id); }}
        />
      ) : null}
    </>
  );
}

// assetMarkdown —— images insert as an image, attachments insert as a link.
// What's stored in the body is a **stable asset URI**, not a presigned URL —
// the latter expires, and writing it into the body would leave a link that
// eventually stops working.
function assetMarkdown(a: CorpusAsset): string {
  const uri = `standmeet-asset:${a.asset_id}`;
  const label = a.original_filename;
  return a.kind === 'image' ? `![${label}](${uri})` : `[${label}](${uri})`;
}

function RowBtn(
  { label, testid, onClick }: { label: string; testid: string; onClick: () => void },
) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className="mono text-[10px] tracking-[0.12em] text-(--color-faint) hover:text-(--color-accent)"
    >
      {label}
    </button>
  );
}
