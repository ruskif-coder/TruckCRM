// Выбор периода для пейджхеда дашборда (задача #129, правка 2026-06-26) —
// раньше Dashboard.tsx рисовал отдельную карточку с инпутами "С"/"По", а
// настоящий календарный элемент дизайна (.pill-btn с иконкой "calendar" в
// .pagehead) стоял в AppShell.tsx нерабочей заглушкой ("16–22 июн", без
// onClick). Пользователь попросил перенести выбор дат именно в этот элемент.
// По умолчанию выбрана текущая неделя (см. defaultWeekRange, она же задаёт
// стартовое состояние dateFrom/dateTo в Dashboard.tsx) — остальные периоды
// ("производные даты") выбираются из списка ниже или вводятся вручную.
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { isoDate } from "../lib/format";

const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function mondayOf(d: Date): Date {
  const m = new Date(d);
  const day = m.getDay();
  m.setDate(m.getDate() + (day === 0 ? -6 : 1 - day));
  return m;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function monthRange(d: Date, offset: number): [Date, Date] {
  const start = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  const end = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
  return [start, end];
}

export function defaultWeekRange(): { dateFrom: string; dateTo: string } {
  const monday = mondayOf(new Date());
  return { dateFrom: isoDate(monday), dateTo: isoDate(addDays(monday, 6)) };
}

// Для страницы «Отчёты» (задача #137, 2026-06-28) — старт на последних N
// ПОЛНЫХ ISO-неделях (пн–вс), не текущей неделе. Снэпим к понедельникам:
// dateFrom = понедельник N недель назад от текущего понедельника,
// dateTo   = воскресенье прошлой (последней завершённой) недели.
// Исправление 2026-07-04: старая формула (сегодня − N*7+1) давала dateFrom
// посередине недели (например, воскресенье 31 мая), из-за чего рейсы
// 28–30 мая попадали в бакет "25–31 мая" ISO-недели, но срезались
// trip_in_range → отчёт показывал 3 рейса вместо 12.
export function lastNWeeksRange(n: number): { dateFrom: string; dateTo: string } {
  const curMon = mondayOf(new Date());               // понедельник текущей недели
  const dateTo = addDays(curMon, -1);                // воскресенье прошлой недели
  const dateFrom = addDays(curMon, -(n * 7));        // понедельник N недель назад
  return { dateFrom: isoDate(dateFrom), dateTo: isoDate(dateTo) };
}

function fmtLabel(dateFrom: string, dateTo: string): string {
  const f = new Date(dateFrom + "T00:00:00");
  const t = new Date(dateTo + "T00:00:00");
  if (f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()) {
    return `${f.getDate()}–${t.getDate()} ${MONTHS_SHORT[f.getMonth()]}`;
  }
  if (f.getFullYear() === t.getFullYear()) {
    return `${f.getDate()} ${MONTHS_SHORT[f.getMonth()]} – ${t.getDate()} ${MONTHS_SHORT[t.getMonth()]}`;
  }
  return `${f.getDate()} ${MONTHS_SHORT[f.getMonth()]} ${f.getFullYear()} – ${t.getDate()} ${MONTHS_SHORT[t.getMonth()]} ${t.getFullYear()}`;
}

type Preset = { key: string; label: string; range: () => [string, string] };

function buildPresets(): Preset[] {
  const today = new Date();
  const thisMonday = mondayOf(today);
  const lastMonday = addDays(thisMonday, -7);
  const [thisMonthStart, thisMonthEnd] = monthRange(today, 0);
  const [lastMonthStart, lastMonthEnd] = monthRange(today, -1);
  return [
    { key: "this-week", label: "Эта неделя", range: () => [isoDate(thisMonday), isoDate(addDays(thisMonday, 6))] },
    { key: "last-week", label: "Прошлая неделя", range: () => [isoDate(lastMonday), isoDate(addDays(lastMonday, 6))] },
    { key: "last-4-weeks", label: "Последние 4 недели", range: () => [isoDate(addDays(thisMonday, -28)), isoDate(addDays(thisMonday, -1))] },
    { key: "last-5-weeks", label: "Последние 5 недель", range: () => [isoDate(addDays(thisMonday, -35)), isoDate(addDays(thisMonday, -1))] },
    { key: "this-month", label: "Этот месяц", range: () => [isoDate(thisMonthStart), isoDate(thisMonthEnd)] },
    { key: "last-month", label: "Прошлый месяц", range: () => [isoDate(lastMonthStart), isoDate(lastMonthEnd)] },
  ];
}

export default function DateRangePicker({
  dateFrom,
  dateTo,
  onChange,
}: {
  dateFrom: string;
  dateTo: string;
  onChange: (dateFrom: string, dateTo: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(dateFrom);
  const [customTo, setCustomTo] = useState(dateTo);
  const ref = useRef<HTMLDivElement>(null);
  const presets = buildPresets();
  const active = presets.find((p) => {
    const [f, t] = p.range();
    return f === dateFrom && t === dateTo;
  });

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    setCustomFrom(dateFrom);
    setCustomTo(dateTo);
  }, [dateFrom, dateTo]);

  function pick(p: Preset) {
    const [f, t] = p.range();
    onChange(f, t);
    setOpen(false);
  }

  function applyCustom() {
    if (customFrom && customTo) {
      onChange(customFrom, customTo);
      setOpen(false);
    }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="pill-btn" onClick={() => setOpen((o) => !o)}>
        <Icon name="calendar" size={17} /> <span className="lbl-hide">{fmtLabel(dateFrom, dateTo)}</span>{" "}
        <Icon name="chevd" size={15} />
      </button>
      {open && (
        <div className="card dropdown-panel" style={{ left: "auto", right: 0, padding: 10 }}>
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              className="btn btn-ghost"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                border: "none",
                fontSize: 13,
                padding: "8px 10px",
                borderRadius: 8,
                fontWeight: active?.key === p.key ? 700 : 500,
                color: active?.key === p.key ? "var(--accent-ink)" : "var(--ink)",
                background: active?.key === p.key ? "var(--accent)" : "transparent",
              }}
              onClick={() => pick(p)}
            >
              {p.label}
            </button>
          ))}
          <div style={{ borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 10 }}>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Произвольный период
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="date"
                className="input"
                style={{ fontSize: 12, padding: "6px 8px", width: 0, flex: 1 }}
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <span style={{ color: "var(--ink-3)" }}>–</span>
              <input
                type="date"
                className="input"
                style={{ fontSize: 12, padding: "6px 8px", width: 0, flex: 1 }}
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="pill-btn solid"
              style={{ width: "100%", marginTop: 10, height: 36, justifyContent: "center" }}
              onClick={applyCustom}
            >
              Применить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
