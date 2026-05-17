// SectionHeader —— admin 每个 section 的标题块。

type Props = {
  title: string;
  subtitle: string;
};

export function SectionHeader({ title, subtitle }: Props) {
  return (
    <header className="mb-10">
      <h1 className="reading-tight text-3xl font-normal">{title}</h1>
      <p className="mono text-xs text-(--color-muted) mt-2">{subtitle}</p>
    </header>
  );
}
