/**
 * NdDateRange — фильтр диапазона дат как лаймовый accent-чип (визуал из макета).
 * Показывает «ДД.ММ.ГГГГ – ДД.ММ.ГГГГ» с иконкой календаря; по клику —
 * поповер с двумя полями «С» / «По». Стили — newdash.css (.nd).
 */
import { useEffect, useRef, useState } from "react";

const fmt = (iso: string): string => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}.${m}.${y}` : "—";
};

export default function NdDateRange({
  from, to, onFrom, onTo,
}: {
  from: string; to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  return (
    <div className="nd-fdrop" ref={ref}>
      <button type="button" className="chip chip--accent" onClick={() => setOpen(o => !o)}>
        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><rect x="1" y="2.2" width="10" height="8.8" rx="2" /><path d="M1 4.8h10" /></svg>
        {fmt(from)} – {fmt(to)}
      </button>

      {open && (
        <div className="nd-fdrop__menu" style={{ minWidth: 210, padding: 12, gap: 10 }}>
          <div className="filter-field filter-field--inline">
            <span className="t-mono-label" style={{ width: 22 }}>С</span>
            <input type="date" className="filter-date" style={{ flex: 1 }} value={from} onChange={e => onFrom(e.target.value)} />
          </div>
          <div className="filter-field filter-field--inline">
            <span className="t-mono-label" style={{ width: 22 }}>По</span>
            <input type="date" className="filter-date" style={{ flex: 1 }} value={to} onChange={e => onTo(e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}
