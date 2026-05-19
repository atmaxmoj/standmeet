// NewlyCreatedBanner —— 刚创建出来的 token plaintext 高亮卡。仅一次。

interface CreatedToken { plaintext: string; name: string }

type Props = { created: CreatedToken | null; dismiss: () => void };

export function NewlyCreatedBanner({ created, dismiss }: Props) {
  return created ? <Card created={created} dismiss={dismiss} /> : null;
}

function Card({ created, dismiss }: { created: CreatedToken; dismiss: () => void }) {
  return (
    <div className="border border-(--color-accent) p-4 space-y-2 mb-4" data-testid="new-token">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-accent)">
        copy this now — you won&apos;t see it again
      </div>
      <div className="reading-tight text-sm text-(--color-muted)">{created.name}</div>
      <code data-testid="token-plaintext" className="mono text-sm break-all block">
        {created.plaintext}
      </code>
      <button
        type="button"
        onClick={dismiss}
        className="mono text-[10.5px] tracking-[0.12em] text-(--color-muted) hover:text-(--color-ink)"
      >
        dismiss
      </button>
    </div>
  );
}
