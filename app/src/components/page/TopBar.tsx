// TopBar —— standmeet · <handle> · live ● 左对齐，dark/light 切换右对齐。
// 每个 visitor 看公开页的第一眼，"live" pulse 让"这是个活实例"的感觉立住。

'use client';

type Props = {
  handle: string;
  dark: boolean;
  onToggleDark: () => void;
};

export function TopBar({ handle, dark, onToggleDark }: Props) {
  return (
    <header className="flex items-center justify-between px-6 lg:px-10 pt-6 pb-4">
      <div className="mono text-[11px] tracking-[0.14em] uppercase flex items-baseline gap-3">
        <span className="text-(--color-ink)">standmeet</span>
        <span className="text-(--color-faint)">/</span>
        <span className="text-(--color-muted)">{handle}</span>
        <span className="ml-2 inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-(--color-accent) live-dot" />
          <span className="text-(--color-faint) text-[10px] tracking-[0.16em]">live</span>
        </span>
      </div>
      <button
        type="button"
        onClick={onToggleDark}
        aria-label="toggle theme"
        className="mono text-[11px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink) transition-colors"
      >
        {dark ? 'light' : 'dark'}
      </button>
    </header>
  );
}
