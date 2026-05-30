// CodeAgentSkillsPicker —— code create modal 里的 agent skills 多选。
// 拆出来守 CreateCodeFields.tsx 的 max-lines。

import type { CodeFormHook } from '@/lib/admin/use-code-form';

// AGENT_SKILLS_CATALOG —— v1 hardcoded list of agent skills the owner can
// grant to a code. Mirrors the backend's capability registry. Adding a new
// agent skill (email.send / payment.refund / …) will append here.
const AGENT_SKILLS_CATALOG: readonly { id: string; label: string; blurb: string }[] = [
  {
    id: 'calendar.book',
    label: 'calendar.book',
    blurb: 'visitor can book a meeting on owner\'s Google Calendar (requires connected calendar + max_bookings quota)',
  },
];

type Props = { form: CodeFormHook };

export function CodeAgentSkillsPicker({ form }: Props) {
  return (
    <div>
      <CodeAgentSkillsKicker text="agent skills · capabilities the visitor's AI can call" />
      <ul
        className="flex flex-col gap-2 mt-2"
        data-testid="code-granted-skills-picker"
      >
        {AGENT_SKILLS_CATALOG.map((s) => (
          <CodeAgentSkillRow
            key={s.id}
            id={s.id}
            label={s.label}
            blurb={s.blurb}
            selected={form.values.grantedSkills.includes(s.id)}
            onToggle={() => form.toggleGrantedSkill(s.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function CodeAgentSkillRow({
  id, label, blurb, selected, onToggle,
}: {
  id: string;
  label: string;
  blurb: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <label
        className="flex items-start gap-3 cursor-pointer p-2 -mx-2 hover:bg-(--color-rule)/10 rounded-sm"
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          data-testid={`code-granted-skill-${id}`}
          className="mt-1"
        />
        <div className="flex-1 min-w-0">
          <span className="mono text-[12px] tracking-[0.06em] text-(--color-ink)">
            {label}
          </span>
          <p className="reading-tight text-[12.5px] text-(--color-muted) mt-0.5">
            {blurb}
          </p>
        </div>
      </label>
    </li>
  );
}

function CodeAgentSkillsKicker({ text }: { text: string }) {
  return (
    <div className="mono text-[10px] tracking-[0.18em] uppercase text-(--color-muted) mb-2">
      {text}
    </div>
  );
}
