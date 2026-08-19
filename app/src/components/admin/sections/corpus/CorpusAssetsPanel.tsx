// CorpusAssetsPanel —— 一条语料的素材区:选文件传上去、看已经挂了哪些、插进正文、
// 设成封面、撤下来。
//
// 这是 owner 在面板上唯一能碰到素材的地方。在它之前,"每个 genre 都能挂素材"这件事
// 后端做完了、访客页面渲染得出来、e2e 也绿 —— 而 owner 在界面上一个入口都没有。
// 一个只有 AI 调得动的能力,对着面板的人等于不存在。
//
// 每一行都说**文件名 + 真实字节数**:owner 传完之后唯一能核对"上去的是不是我选的那份"
// 的就是这两样。一句"已上传"不是回执。

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
  // insertIntoBody —— 把 `standmeet-asset:<id>` 引用写进正文。正文的状态在表单那边,
  // 所以这里只发一个字符串出去,不自己碰 body。
  insertIntoBody: (markdown: string) => void;
  // dropFromBody —— 撤掉素材时把正文里那条引用一并去掉（F-L-50）。**跟 insertIntoBody
  // 成对**：能往正文里塞的东西，就得能从正文里收回，否则「删掉」只删了一半，而剩下的
  // 那一半只有访客看得见。
  dropFromBody: (assetID: string) => void;
  // 封面是**表单状态**,不是这里自己发的一个请求 —— 单独 PATCH 会把正文清空。
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
      {/* 这个标记有自己的 testid:行里另一颗按钮的文案也含 "cover"，按文本找它的断言
          在封面撤掉之后照样通过（[[assertion-that-cannot-fail]]）。 */}
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
            // 删成了才动正文：请求失败时正文不该被改（那会让 owner 保存一份跟服务端
            // 不一致的稿子）。
            .then(() => { props.dropFromBody(asset.asset_id); })
            .catch((e: unknown) => { report(e); });
        }}
      />
    </li>
  );
}

// BodyBoundBtns —— 那两个**改的是正文/表单状态**的动作。
//
// 封面那颗是**开关**:已经是封面时它说的是「撤掉封面」并发空串。原来它只有「设为封面」
// 这一个方向 —— 设上之后想撤，唯一的办法是把这份素材整个删掉（F-L-38(a) 同一族）。
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
      <RowBtn
        label={isCover ? t('unsetCover') : t('setCover')}
        testid={`${props.testidPrefix}-asset-cover-${asset.asset_id}`}
        onClick={() => { props.onSetCover(isCover ? '' : asset.asset_id); }}
      />
    </>
  );
}

// assetMarkdown —— 图插成 image，附件插成链接。正文里存的是**稳定的 asset URI**,
// 不是预签名地址 —— 后者会过期,写进正文就是一条迟早打不开的链接。
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
