// Общие типы недельного разреза перевозчик×машина×водитель (задача #129) —
// вынесены из Dashboard.tsx 2026-06-26 (задача #136), когда тот же
// /api/dashboard/weekly понадобился ещё и отдельной вкладке "Отчёты"
// (Reports.tsx, фильтры по колонкам + сортировка). Один источник типов,
// чтобы виджет на Дашборде и страница Отчётов не расходились со временем.
// Формулы и честные оговорки (driver_pct placeholder, toll всегда 0 - нет
// живого поля) - см. backend/app/calculations.py:weekly_pnl().
export type WeeklyRow = {
  truck_id: number | null;
  driver_id: number | null;
  carrier_name: string;
  trips: number;
  gross: number;
  commission_pct: number;
  commission_rub: number;
  net: number;
  fines: number;
  toll: number;
  fuel: number;
  driver_pct: number;
  driver_payout: number;
  driver_paid: number;
  profit: number;
  profitability: number | null;
  price_per_trip: number;
  work_days: number;
  price_per_day: number;
  fine_pct: number | null;
  truck_label: string;
  truck_plate: string;
  driver_label: string;
};

export type WeeklyTotals = {
  trips: number;
  gross: number;
  commission_rub: number;
  net: number;
  fines: number;
  toll: number;
  fuel: number;
  driver_payout: number;
  profit: number;
  profitability: number | null;
};

export type WeeklyWeek = { week_start: string; week_end: string; rows: WeeklyRow[]; totals: WeeklyTotals };
export type WeeklyData = { period: { date_from: string; date_to: string }; weeks: WeeklyWeek[]; notes: string[] };

export function pct(n: number | null): string {
  return n === null ? "—" : `${(n * 100).toFixed(0)}%`;
}
