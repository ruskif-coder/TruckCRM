import { useEffect, useRef, useState } from "react";

// Checkbox-dropdown filter, pulled out of Trips.tsx on 2026-06-19 evening
// when the Fuel page needed the same multi-select filter widget.
export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle(opt: string) {
    const next = new Set(selected);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange(next);
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <label className="label">{label}</label>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ fontSize: 13, padding: "9px 16px", width: "100%", textAlign: "left" }}
        onClick={() => setOpen((o) => !o)}
      >
        {selected.size > 0 ? `Выбрано: ${selected.size}` : "Все"} ▾
      </button>
      {open && (
        <div className="card dropdown-panel">
          {selected.size > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "4px 10px", marginBottom: 8 }}
              onClick={() => onChange(new Set())}
            >
              Сбросить
            </button>
          )}
          {options.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--smoke)", margin: 0 }}>Нет данных</p>
          )}
          {options.map((opt) => (
            <label key={opt} className="checkbox-row">
              <input type="checkbox" checked={selected.has(opt)} onChange={() => toggle(opt)} />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
