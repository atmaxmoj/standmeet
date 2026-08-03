// CorpusMedia —— 一条语料身上的素材,在**访客那一侧**的三个渲染位。
//
// wiki 和 output 用同一份:正文里的 `standmeet-asset:<id>` 展成可访问地址、hero 铺
// owner 设的封面图、附件渲成带真实字节数的下载区。
//
// 抽出来是因为 output 那条一开始**根本没接** —— 而 SDK 里那句注释写着"结构跟
// WikiLandingView 一致"。各写一份的话,下一个 genre 接上来时还会再漏一次;而漏了的样子
// 是"页面看起来正常,只是图不在" —— 没有报错,没有人会去查。

// **这个文件是 client component。** 两个纯函数(expandBody / coverURL)住在
// lib/corpus/media.ts —— 它们没有 'use client',所以**服务端组件也调得动**。
//
// output 的落地页是 Server Component:把纯函数放进这个文件里,它一调用就是
// "Attempted to call coverURL() from the server but coverURL is on the client",
// 页面整个 500。而 wiki 那条是 client,不会报 —— 一个只在其中一条路上炸的错误。

'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';

import { formatBytes } from '@/lib/format/bytes';
import type { CorpusAsset } from '@/lib/corpus/media';

/**
 * CoverImage —— hero 上铺 owner 设的那张图。
 *
 * `unoptimized`:地址是 owner 自己存储上的预签名 URL(每个部署不同、带过期签名)。
 * Next 的图片优化器对不在 images.remotePatterns 里的 host 回 400,走 /_next/image
 * 就渲成破图(writings 那边踩过,见 Cover.tsx 的 F-I-1)。
 *
 * testid 挂在外层 span:testid 是测试的关注点,只能落在真实 DOM 元素上。
 */
export function CoverImage({ url, testid }: { url?: string; testid: string }) {
  return url ? (
    <span data-testid={testid}>
      <Image src={url} alt="" fill unoptimized className="object-cover" />
    </span>
  ) : null;
}

/**
 * Attachments —— 正文底下的下载区。只列 attachment,图片属于正文。
 *
 * 每一行说**文件名 + 真实大小** —— 那是访客决定点不点的依据。一个只写"下载"的按钮
 * 把「一份 40 页的 PDF」和「一张截图」显示成同一个东西。一个附件都没有时整块不渲染:
 * 空标题下面一片空白比没有更糟。
 */
export function Attachments(
  { assets, testid }: { assets?: readonly CorpusAsset[]; testid: string },
) {
  const t = useTranslations('reader');
  const files = (assets ?? []).filter((a) => a.kind === 'attachment');
  return files.length > 0 ? (
    <section className="mt-10 pt-5 border-t border-(--color-rule)" data-testid={testid}>
      <span className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) block mb-2">
        {t('wiki.attachments')}
      </span>
      <ul className="space-y-1">
        {files.map((a) => <AttachmentRow key={a.asset_id} asset={a} />)}
      </ul>
    </section>
  ) : null;
}

function AttachmentRow({ asset }: { asset: CorpusAsset }) {
  return (
    <li className="flex items-baseline gap-3 mono text-[11.5px]">
      <a
        href={asset.url}
        download={asset.original_filename}
        data-testid={`corpus-attachment-${asset.asset_id}`}
        className="text-(--color-ink) hover:text-(--color-accent)"
      >
        {asset.original_filename}
      </a>
      <span className="text-(--color-faint)">{formatBytes(asset.size_bytes)}</span>
    </li>
  );
}
