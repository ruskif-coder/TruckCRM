/**
 * NdMultiSelect — фильтр-дропдаун с мультивыбором (чип + поповер с чекбоксами).
 * Стили — newdash.css (.nd). Использование:
 *   <NdMultiSelect label="Статус" options={statusOptions} selected={set} onChange={setSet} />
 */
import { useEffect, useRef, useState } from "react";

export default function NdMultiSelect({
  label, options, selected, onChange, allLabel = "Все",
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  allLabel?: string;
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

  const summary = selected.size === 0 ? allLabel : selected.size === 1 ? [...selected][0] : `${selected.size} выбр.`;
  const toggle = (v: string) => {
    const n = new Set(selected);
    n.has(v) ? n.delete(v) : n.add(v);
    onChange(n);
  };

  return (
    <div className="nd-fdrop" ref={ref}>
      <button
        type="button"
        className="chip"
        aria-pressed={selected.size > 0}
        onClick={() => setOpen(o => !o)}
      >
        <span className="t-mono-label" style={{ lineHeight: 1 }}>{label}</span>
        <span style={{ fontWeight: 500, lineHeight: 1, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
        <svg width="9" height="6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .15s" }}><path d="M1 1.4 4.5 4.6 8 1.4" /></svg>
      </button>

      {open && (
        <div className="nd-fdrop__menu">
          {selected.size > 0 && (
            <button type="button" className="nd-fdrop__clear" onClick={() => onChange(new Set())}>Сбросить</button>
          )}
          {options.length === 0 ? (
            <div className="t-body-s muted" style={{ padding: "8px 10px" }}>Нет значений</div>
          ) : options.map(o => (
            <button type="button" key={o} className="nd-fdrop__item" onClick={() => toggle(o)}>
              <span className="checkbox" role="checkbox" aria-checked={selected.has(o)} />
              <span className="ellip" style={{ flex: 1 }}>{o}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
