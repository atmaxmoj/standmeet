// Root path 的 v1 行为：单 owner instance 时直接跳到 owner 的 handle 页。
// owner handle 在 instance 维度是稳定的（一次 claim 之后不可改），所以
// SSR fetch backend 拿一次足够。
//
// M14 多租户时这里改成 multi-owner landing。

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { loadDefaultHandle } from '@/lib/api/instance';

export default async function Root() {
  const handle = await loadDefaultHandle();
  handle && redirect(`/${handle}`);
  return (
    <main className="mx-auto max-w-md px-6 py-24">
      <h1 className="reading text-2xl mb-4">StandMeet</h1>
      <p className="reading">
        This instance is not yet claimed. Visit{' '}
        <Link className="link" href="/setup">/setup</Link> to claim it.
      </p>
    </main>
  );
}
