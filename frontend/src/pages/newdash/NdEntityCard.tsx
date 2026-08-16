/**
 * NdEntityCard — карточка сущности для мобильного вида реестров (React-порт
 * UI.entityCard из design-handoff). На телефоне (≤640px) строка таблицы
 * рендерится этой карточкой: заголовок + подзаголовок + правый слот (статус)
 * + сетка «фактов» (лейбл: значение). Значения — готовый ReactNode из того же
 * конфига колонок NdDataTable. Стили — newdash.css (.nd-ecard*, под @media).
 */
import type { ReactNode } from "react";

export type NdFact = { label: string; value: ReactNode };
export type NdEntityCardProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;          // правый слот шапки (обычно статус-чип)
  facts?: NdFact[];
  onClick?: () => void;
  clickable?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
};

export default function NdEntityCard(p: NdEntityCardProps) {
  return (
    <div
      className={"nd-ecard" + (p.clickable ? " nd-ecard--clickable" : "") + (p.selected ? " is-selected" : "")}
      aria-selected={p.selected || undefined}
      onClick={e => {
        if ((e.target as HTMLElement).closest("[data-pick]")) return;
        p.onClick?.();
      }}
    >
      <div className="nd-ecard__top">
        {p.selectable && (
          <button
            className="checkbox nd-ecard__pick"
            role="checkbox"
            aria-checked={p.selected}
            data-pick
            onClick={e => { e.stopPropagation(); p.onToggle?.(); }}
          />
        )}
        <div className="nd-ecard__title-box">
          <div className="nd-ecard__title">{p.title}</div>
          {p.subtitle ? <div className="nd-ecard__subtitle">{p.subtitle}</div> : null}
        </div>
        {p.right ? <div className="nd-ecard__right">{p.right}</div> : null}
      </div>
      {p.facts && p.facts.length ? (
        <div className="nd-ecard__facts">
          {p.facts.map((f, i) => (
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
