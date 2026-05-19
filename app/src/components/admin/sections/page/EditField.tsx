// EditField —— label + input/textarea。multiline=N 时是 textarea。

type Props = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  monoHint?: string;
  multiline?: number;
  testid?: string;
};

export function EditField(props: Props) {
  return (
    <div>
      <FieldLabel label={props.label} monoHint={props.monoHint} />
      <FieldInput {...props} />
    </div>
  );
}

function FieldLabel({ label, monoHint }: { label: string; monoHint?: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-1.5 flex items-baseline gap-2 flex-wrap">
      <span>{label}</span>
      <Hint text={monoHint} />
    </div>
  );
}

function Hint({ text }: { text?: string }) {
  return text
    ? <span className="text-(--color-faint) normal-case tracking-[0.06em]">· {text}</span>
    : null;
}

function FieldInput(props: Props) {
  return props.multiline
    ? <FieldTextarea
        rows={props.multiline} value={props.value}
        onChange={props.onChange} placeholder={props.placeholder} testid={props.testid}
      />
    : <FieldSingleLine
        value={props.value} onChange={props.onChange}
        placeholder={props.placeholder} testid={props.testid}
      />;
}

function FieldTextarea({
  rows, value, onChange, placeholder, testid,
}: {
  rows: number; value: string; onChange: (v: string) => void;
  placeholder?: string; testid?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      data-testid={testid}
      className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading-tight text-[15.5px] resize-none"
    />
  );
}

function FieldSingleLine({
  value, onChange, placeholder, testid,
}: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; testid?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={testid}
      className="w-full bg-transparent border-b border-(--color-rule) focus:border-(--color-ink) py-2 reading-tight text-[15.5px]"
    />
  );
}
