/**
 * NdFilters — фильтры реестра. На десктопе (>640px) — обычная строка `.filterbar`
 * с контролами (без изменений). На телефоне (≤640px) строка прячется, а фильтры
 * открываются листом снизу по кнопке-воронке (NdFilterButton, ставится рядом с
 * поиском). Лист: заголовок «Фильтры» + раздел, контролы строками, футер
 * «Показать» (закрыть) / «Сбросить» (onReset). Стили — newdash.css (.nd-filter-btn,
 * .nd-fsheet). Фильтры применяются на лету при изменении контролов.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

function useIsPhone() {
  const [isPhone, setIsPhone] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setIsPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return isPhone;
}

const FunnelIcon = (
  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 3.5h13l-5 6v4l-3 1.5v-5.5z" />
  </svg>
);

// Кнопка-воронка с бейджем числа активных фильтров. Видна только на телефоне.
export function NdFilterButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button className="nd-filter-btn" onClick={onClick} title="Фильтры" aria-label="Фильтры">
      {FunnelIcon}
      {count > 0 && <span className="nd-filter-btn__badge">{count > 9 ? "9+" : count}</span>}
    </button>
  );
}

export default function NdFilters({ open, onClose, onReset, section, children }: {
  open: boolean;
  onClose: () => void;
  onReset: () => void;
  section?: string;
  children: ReactNode;
}) {
  const isPhone = useIsPhone();
  if (!isPhone) return <div className="filterbar">{children}</div>;
  if (!open) return null;
  return (
    <div className="nd-msheet" onClick={onClose}>
      <div className="nd-msheet__backdrop" />
      <div className="nd-msheet__panel nd-fsheet" onClick={e => e.stopPropagation()}>
        <div className="nd-msheet__grip"><i /></div>
        <div className="nd-fsheet__head">
          <div style={{ minWidth: 0 }}>
            <div className="t-h2">Фильтры</div>
            {section && <div className="t-body-s muted" style={{ marginTop: 2 }}>{section}</div>}
          </div>
          <button className="nd-fsheet__close icon-btn icon-btn--plain" title="Закрыть" onClick={onClose}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><path d="M3.5 3.5 10.5 10.5" /><path d="M10.5 3.5 3.5 10.5" /></svg>
          </button>
        </div>
        <div className="nd-fsheet__body">{children}</div>
        <div className="nd-fsheet__foot">
          <button className="btn btn--primary" style={{ flex: 1 }} onClick={onClose}>Показать</button>
          <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onReset}>Сбросить</button>
        </div>
      </div>
    </div>
  );
}
