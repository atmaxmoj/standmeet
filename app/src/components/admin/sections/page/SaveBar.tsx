// SaveBar —— sticky bottom 保存条。dirty / lastSaved 状态 + save & revert。

'use client';

type Props = {
  dirty: boolean;
  savedAt: number | null;
  saving: boolean;
  onSave: () => void;
  onRevert: () => void;
};

export function SaveBar({ dirty, savedAt, saving, onSave, onRevert }: Props) {
  return (
    <div className="sticky bottom-0 z-10 -mx-8 lg:-mx-12 px-8 lg:px-12 py-3 bg-(--color-paper)/90 backdrop-blur border-t border-(--color-rule) flex items-center justify-between mb-0 mt-8">
      <SaveStatus dirty={dirty} savedAt={savedAt} saving={saving} />
      <SaveActions dirty={dirty} saving={saving} onSave={onSave} onRevert={onRevert} />
    </div>
  );
}

function SaveStatus({
  dirty, savedAt, saving,
}: { dirty: boolean; savedAt: number | null; saving: boolean }) {
  return (
    <div className="flex items-center gap-3 mono text-[10.5px] tracking-[0.14em] uppercase">
      <StatusDot dirty={dirty} saving={saving} />
      <StatusLabel dirty={dirty} savedAt={savedAt} saving={saving} />
    </div>
  );
}

function StatusDot({ dirty, saving }: { dirty: boolean; saving: boolean }) {
  const cls = saving ? 'bg-(--color-muted)' : dirty ? 'bg-(--color-accent) live-dot' : 'bg-(--color-muted)/60';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${cls}`} />;
}

function StatusLabel({
  dirty, savedAt, saving,
}: { dirty: boolean; savedAt: number | null; saving: boolean }) {
  return saving ? <SavingTxt /> : <RestingLabel dirty={dirty} savedAt={savedAt} />;
}

function SavingTxt() { return <span className="text-(--color-muted)">saving…</span>; }

function RestingLabel({ dirty, savedAt }: { dirty: boolean; savedAt: number | null }) {
  return dirty ? <span className="text-(--color-accent)">unsaved changes</span>
    : savedAt !== null
      ? <span className="text-(--color-muted)" data-testid="saved">saved</span>
      : <span className="text-(--color-muted)">in sync</span>;
}

function SaveActions({
  dirty, saving, onSave, onRevert,
}: { dirty: boolean; saving: boolean; onSave: () => void; onRevert: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <RevertBtn shown={dirty && !saving} onRevert={onRevert} />
      <button
        type="button"
        data-testid="save"
        onClick={onSave}
        disabled={!dirty || saving}
        className="mono text-[11px] tracking-[0.16em] uppercase bg-(--color-ink) text-(--color-paper) px-4 py-2 hover:bg-(--color-accent) transition-colors disabled:opacity-30"
      >
        save
      </button>
    </div>
  );
}

function RevertBtn({ shown, onRevert }: { shown: boolean; onRevert: () => void }) {
  return shown ? (
    <button
      type="button"
      onClick={onRevert}
      className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-accent) transition-colors"
    >
      revert
    </button>
  ) : null;
}
