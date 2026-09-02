// StringListEditor — editor for a list of single-value strings (hero examples,
// looking_for, etc).

type Props = {
  label: string;
  items: readonly string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  addLabel?: string;
  renderHint?: string;
};

export function StringListEditor(props: Props) {
  return (
    <div>
      <Header label={props.label} addLabel={props.addLabel} onAdd={() => onAdd(props)} renderHint={props.renderHint} />
      <div className="space-y-1">
        {props.items.map((v, i) => (
          <Row key={i} idx={i} value={v} placeholder={props.placeholder} onUpdate={(t) => updateItem(props, i, t)} onRemove={() => removeItem(props, i)} />
        ))}
      </div>
    </div>
  );
}

function Header({
  label, addLabel, onAdd, renderHint,
}: {
  label: string; addLabel?: string; onAdd: () => void; renderHint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between mb-2 gap-4 flex-wrap">
      <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted)">{label}</div>
      <div className="flex items-baseline gap-4">
        <HintText text={renderHint} />
        <button
          type="button"
          onClick={onAdd}
          className="mono text-[10.5px] tracking-[0.14em] uppercase text-(--color-muted) hover:text-(--color-ink)"
        >
          {addLabel ?? '＋ add'}
        </button>
      </div>
    </div>
  );
}

function HintText({ text }: { text?: string }) {
  return text
    ? <span className="mono text-[10px] tracking-[0.1em] text-(--color-faint)">{text}</span>
    : null;
}

function Row({
  idx, value, placeholder, onUpdate, onRemove,
}: {
  idx: number; value: string; placeholder?: string;
  onUpdate: (v: string) => void; onRemove: () => void;
}) {
  return (
    <div className="flex items-baseline gap-3 border-b border-(--color-rule)/50 py-1">
      <span className="mono text-[10px] text-(--color-faint) tabular-nums w-5 pt-1">
        {String(idx + 1).padStart(2, '0')}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onUpdate(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent py-2 reading-tight text-[15px]"
      />
      <button
        type="button"
        onClick={onRemove}
        className="mono text-[10px] text-(--color-faint) hover:text-(--color-accent) pt-1"
      >
        ×
      </button>
    </div>
  );
}

function onAdd(p: Props): void {
  p.onChange([...p.items, '']);
}
function updateItem(p: Props, i: number, v: string): void {
  p.onChange(p.items.map((x, j) => j === i ? v : x));
}
function removeItem(p: Props, i: number): void {
  p.onChange(p.items.filter((_, j) => j !== i));
}
