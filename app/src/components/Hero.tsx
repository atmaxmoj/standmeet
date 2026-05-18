// Hero —— owner 名字 + 一段 serif prose + 推荐问题列表。
//
// "askable" 是点击就发问的 token；这里只渲染样式，把 onClick 暴露给 caller
// 让 ChatDock 把它接到 send 上。

import type { PageContent, PublicOwnerView } from '@/lib/api/public';

type Props = {
  owner: PublicOwnerView;
  content: PageContent;
  onAsk: (q: string) => void;
};

export function Hero({ owner, content, onAsk }: Props) {
  return (
    <section className="mx-auto max-w-2xl px-6 pt-24 pb-12">
      <div className="smallcaps mb-6">{owner.handle} · standmeet</div>
      <h1 className="reading reading-tight text-3xl font-medium tracking-tight mb-6">
        {owner.full_name}
      </h1>
      <p className="reading">{content.hero_prose}</p>
      <ExamplesList examples={content.hero_examples} onAsk={onAsk} />
    </section>
  );
}

function ExamplesList({ examples, onAsk }: { examples: readonly string[]; onAsk: (q: string) => void }) {
  return (
    <ul className="mt-8 space-y-2">
      {examples.map((q) => (
        <li key={q}>
          <button
            type="button"
            className="askable mono text-sm text-left"
            onClick={() => onAsk(q)}
          >
            {q}
          </button>
        </li>
      ))}
    </ul>
  );
}
