/**
 * newdash/shared — общие мелкие компоненты и хелперы контура .nd.
 * Вынесено из повторов по страницам (аудит 2026-08-09): блок поиска,
 * поле формы, форматтер даты-времени, короткая дата, дефолтный диапазон,
 * обёртка mouse-drag. Использовать вместо локальных копий.
 */
import { isoDate } from "../../lib/format";

// ── Поиск (иконка + прозрачный инпут) — был скопирован в ~14 файлах ──
export function NdSearch({ value, onChange, placeholder, width = 260 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; width?: number;
}) {
  return (
    <div className="search" style={{ width }}>
      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round"><circle cx="6.2" cy="6.2" r="4.2" /><path d="M9.4 9.4 12.6 12.6" /></svg>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ flex: 1, minWidth: 0, border: 0, background: "none", outline: "none", font: "400 12.5px var(--font-ui)", color: "var(--ink)" }} />
    </div>
  );
}

// ── Поле формы (label + input) — был компонент F/Field в 4 файлах ──
export function NdField({ label, v, on, type, wide, placeholder }: {
  label: string; v: string; on: (v: string) => void; type?: string; wide?: boolean; placeholder?: string;
}) {
  return (
    <div className={"field" + (wide ? " form-grid__field--wide" : "")}>
      <span className="field__label">{label}</span>
      <input type={type || "text"} className="field__input" value={v} placeholder={placeholder} onChange={e => on(e.target.value)} />
    </div>
  );
}

// ── Дата-время. utc:true дописывает Z к наивному UTC (серверные created_at),
//    иначе показываем как есть (wall-clock из XLSX). year — 2-значный по умолч. ──
export function fmtDateTime(iso: unknown, opts?: { year?: "2-digit" | "numeric"; utc?: boolean }): string {
  if (typeof iso !== "string" || !iso) return "—";
  const src = opts?.utc && !/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? `${iso}Z` : iso;
  const d = new Date(src);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: opts?.year ?? "2-digit" }) + " " +
         d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

// ── Короткая дата с 2-значным годом: «2026-07-06» → «06.07.26» ──
export const shortDate = (iso: string) => {
  const [y, m, d] = (iso || "").slice(0, 10).split("-");
  return y ? `${d}.${m}.${y.slice(2)}` : "—";
};

// ── Дефолтный диапазон дат (последние N дней) для фильтров ──
export function defaultRange(days = 60): { from: string; to: string } {
  return { from: isoDate(new Date(Date.now() - days * 864e5)), to: isoDate(new Date()) };
}

// ── Единая обёртка перетаскивания мышью: навесить move/up + снять по отпусканию ──
export function startDrag(onMove: (e: MouseEvent) => void, onUp?: () => void) {
  const move = (e: MouseEvent) => onMove(e);
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    onUp?.();
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}
