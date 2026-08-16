/**
 * NdEntityCard — карточка сущности для мобильного вида реестров (React-порт
 * UI.entityCard из design-handoff). На телефоне (≤640px) строка таблицы
 * рендерится этой карточкой: заголовок + подзаголовок + правый слот (статус/сумма)
 * + сетка «фактов» (лейбл: значение). Значения — готовый ReactNode из того же
 * конфига колонок NdDataTable. Стили — newdash.css (.nd-ecard*, под @media).
 *
 * collapsible: карточка свёрнута по умолчанию (видна только шапка + шеврон),
 * факты раскрываются по тапу — для реестров вроде Рейсов, где строк много.
 */
import { useState } from "react";
import type { ReactNode } from "react";

export type NdFact = { label: string; value: ReactNode };
export type NdEntityCardProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;          // правый слот шапки (статус-чип или сумма/штраф)
  facts?: NdFact[];
  onClick?: () => void;
  clickable?: boolean;
  collapsible?: boolean;      // свернуть факты по умолчанию, раскрывать по тапу
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
};

const Chevron = ({ open }: { open: boolean }) => (
  <svg className="nd-ecard__chev" data-open={open || undefined} width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 6.5 8 10l3.5-3.5" />
  </svg>
);

export default function NdEntityCard(p: NdEntityCardProps) {
  const [open, setOpen] = useState(false);
  const hasFacts = !!(p.facts && p.facts.length);
  const showFacts = hasFacts && (!p.collapsible || open);
  const clickable = p.collapsible ? hasFacts : !!p.clickable;

  const onCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-pick]")) return;
    if (p.collapsible) { if (hasFacts) setOpen(o => !o); return; }
    p.onClick?.();
  };

  return (
    <div
      className={"nd-ecard" + (clickable ? " nd-ecard--clickable" : "") + (p.selected ? " is-selected" : "")}
      aria-selected={p.selected || undefined}
      onClick={onCardClick}
    >
      <div className="nd-ecard__top">
        {p.selectable && (
          <button className="checkbox nd-ecard__pick" role="checkbox" aria-checked={p.selected} data-pick
            onClick={e => { e.stopPropagation(); p.onToggle?.(); }} />
        )}
        <div className="nd-ecard__title-box">
          <div className="nd-ecard__title">{p.title}</div>
          {p.subtitle ? <div className="nd-ecard__subtitle">{p.subtitle}</div> : null}
        </div>
        {p.right ? <div className="nd-ecard__right">{p.right}</div> : null}
        {p.collapsible && hasFacts ? <Chevron open={open} /> : null}
      </div>
      {showFacts ? (
        <div className="nd-ecard__facts">
          {p.facts!.map((f, i) => (
            <div className="nd-ecard__fact" key={i}>
              <div className="t-mono-label">{f.label}</div>
              <div className="nd-ecard__fact-value">{f.value}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
