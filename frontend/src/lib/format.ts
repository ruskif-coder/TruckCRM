// Shared formatting helpers, pulled out of Trips.tsx on 2026-06-19 evening
// when the Fuel page needed the exact same money/date formatting and
// filter-option helpers, so the two list pages don't drift out of sync.

export const money = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽";

// Тот же money(), но без копеек - только для виджета "Структура расходов" на
// дашборде (2026-06-28, по просьбе пользователя). Не меняет money() напрямую,
// чтобы не убрать копейки везде, где они по-прежнему нужны (Отчёты, Реестр
// расходов, Топливо и т.д.).
export const moneyWhole = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";

export const fmtDateTime = (d: string | null) =>
  d
    ? new Date(d).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

// toISOString() возвращает UTC-дату — на UTC+ таймзонах полночь локального
// понедельника превращается в воскресенье/субботу. Используем локальные геттеры.
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Plain DATE fields (no time component, e.g. CashFlowEntry.date) should not
// go through `new Date(str)` for display - that re-parses as UTC midnight
// and can shift a day depending on the browser's timezone. Format the
// "YYYY-MM-DD" string directly instead. Added 2026-06-20 for Expenses.tsx.
export const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return y && m && day ? `${day}.${m}.${y}` : "—";
};

export function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, "ru"));
}
