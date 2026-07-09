import { useEffect, useRef, useState } from "react";

// Dropdown-фильтр с мульти-выбором. Изначально — checkbox-row (2026-06-19),
// переработан 2026-07-09: вместо чекбоксов — кнопки-пилюли (выбранные
// подсвечиваются акцентом). Кнопка-триггер и дропдаун стилистически
// согласованы с остальными .input-элементами (border-radius 10px).
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

  const hasActive = selected.size > 0;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <label className="label">{label}</label>
      <button
        type="button"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          padding: "10px 12px",
          fontSize: 14,
          fontFamily: "inherit",
          fontWeight: hasActive ? 600 : 400,
          background: hasActive ? "var(--iris)" : "var(--canvas)",
          color: hasActive ? "#fff" : "var(--ink)",
          border: "1px solid",
          borderColor: hasActive ? "var(--iris)" : "var(--edge)",
          borderRadius: 10,
          cursor: "pointer",
          transition: "all .15s ease",
          whiteSpace: "nowrap",
        }}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{hasActive ? `${label}: ${selected.size}` : `${label}`}</span>
        <span style={{ opacity: 0.6, fontSize: 11 }}>▾</span>
      </button>
      {open && (
        <div
          className="card dropdown-panel"
          style={{ padding: "8px", borderRadius: 12, boxShadow: "var(--shadow-lg)" }}
        >
          {/* Кнопка «Все» — сбрасывает фильтр */}
          <button
            type="button"
            onClick={() => { onChange(new Set()); setOpen(false); }}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "7px 12px",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "inherit",
              fontWeight: hasActive ? 400 : 600,
              background: hasActive ? "transparent" : "var(--surface-2)",
              color: hasActive ? "var(--ink-3)" : "var(--ink)",
              marginBottom: 4,
            }}
          >
            Все
          </button>
          {options.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--smoke)", margin: "4px 0", padding: "0 4px" }}>Нет данных</p>
          )}
          {options.map((opt) => {
            const active = selected.has(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 12px",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontWeight: active ? 600 : 400,
                  background: active ? "var(--iris)" : "transparent",
                  color: active ? "#fff" : "var(--ink)",
                  transition: "background .12s ease, color .12s ease",
                }}
                onMouseEnter={(e) => {
                  if (!active) (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-2)";
                }}
                onMouseLeave={(e) => {
                  if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
