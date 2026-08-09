/**
 * NewDashReports — раздел «Отчёты» (/newdash/reports).
 * Порт вкладки «Водители» из старой Reports.tsx: недельный разрез
 * перевозчик×машина×водитель по /api/dashboard/weekly (calculations.weekly_pnl).
 * Функционал 1:1 (фильтры по колонкам, сортировка, вид Полный/Для водителя,
 * период последних 5 недель, honest-оговорки). Оформление — наш контур .nd:
 * topbar → NdSectionTabs → summarystrip → filterbar → NdDataTable.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../../api";
import { money, uniqueSorted } from "../../lib/format";
import { pct as pctFrac, type WeeklyData, type WeeklyRow } from "../../lib/weekly";
import { lastNWeeksRange } from "../../components/DateRangePicker";
import NdMenu from "./NdMenu";
import NdSectionTabs, { REPORTS_TABS } from "./NdSectionTabs";
import NdMultiSelect from "./NdMultiSelect";
import NdDateRange from "./NdDateRange";
import NdSortReset from "./NdSortReset";
import NdDataTable from "./NdDataTable";
import type { Column } from "./NdDataTable";
import { shortDate as sd, NdSearch } from "./shared";
import "./newdash.css";

type FlatRow = WeeklyRow & { week_start: string; week_end: string; id: string };
type ReportView = "full" | "driver";

// Колонки, скрываемые в режиме «Для водителя» (коммерческая сторона рейса).
const DRIVER_HIDDEN = new Set(["gross", "commission_pct", "commission_rub", "profit", "profitability", "price_per_trip", "price_per_day"]);

export default function NewDashReports() {
  const navigate = useNavigate();
  const [data, setData] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [dense, setDense] = useState(true);
  const [view, setView] = useState<ReportView>("full");

  const [carrierF, setCarrierF] = useState<Set<string>>(new Set());
  const [truckF, setTruckF] = useState<Set<string>>(new Set());
  const [driverF, setDriverF] = useState<Set<string>>(new Set());

  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});

  // По умолчанию — последние 5 недель (как в оригинале Reports.tsx).
  const [{ dateFrom: initFrom, dateTo: initTo }] = useState(() => lastNWeeksRange(5));
  const [dateFrom, setDateFrom] = useState(initFrom);
  const [dateTo, setDateTo] = useState(initTo);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    api.get<WeeklyData>(`/api/dashboard/weekly?date_from=${dateFrom}&date_to=${dateTo}`)
      .then(r => { if (!cancelled) setData(r); })
      .catch(err => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Ошибка загрузки"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  const flatRows: FlatRow[] = useMemo(
    () => data
      ? data.weeks.flatMap(w => w.rows.map((r, i) => {
          const R = Math.round;   // копейки округляем везде
          return {
            ...r,
            gross: R(r.gross), commission_rub: R(r.commission_rub), net: R(r.net),
            fines: R(r.fines), toll: R(r.toll), fuel: R(r.fuel),
            driver_payout: R(r.driver_payout), profit: R(r.profit),
            price_per_trip: R(r.price_per_trip), price_per_day: R(r.price_per_day),
            week_start: w.week_start, week_end: w.week_end,
            id: `${w.week_start}-${r.truck_id}-${r.driver_id}-${i}`,
          };
        }))
      : [],
    [data]);

  const carrierOptions = useMemo(() => uniqueSorted(flatRows.map(r => r.carrier_name || "—")), [flatRows]);
  const truckOptions = useMemo(() => uniqueSorted(flatRows.map(r => r.truck_label)), [flatRows]);
  const driverOptions = useMemo(() => uniqueSorted(flatRows.map(r => r.driver_label)), [flatRows]);

  const rows: FlatRow[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    return flatRows.filter(r =>
      (carrierF.size === 0 || carrierF.has(r.carrier_name || "—")) &&
      (truckF.size === 0 || truckF.has(r.truck_label)) &&
      (driverF.size === 0 || driverF.has(r.driver_label)) &&
      (!s || `${r.carrier_name} ${r.truck_label} ${r.driver_label}`.toLowerCase().includes(s)));
  }, [flatRows, carrierF, truckF, driverF, q]);

  const t = useMemo(() => rows.reduce((a, r) => ({
    trips: a.trips + r.trips, gross: a.gross + r.gross, net: a.net + r.net,
    fines: a.fines + r.fines, profit: a.profit + r.profit,
  }), { trips: 0, gross: 0, net: 0, fines: 0, profit: 0 }), [rows]);
  const totalProfitability = t.net ? t.profit / t.net : null;

  // Ширины: пороги-минимумы + доли (fr) — таблица растягивается на всю ширину
  // карточки и вписывается в экран 2560 без горизонтального скролла.
  const allColumns: Column<FlatRow>[] = [
    { key: "week_start", label: "Период", type: "date", width: "132px", sticky: true, strong: true,
      format: (_, r) => (r ? `${sd(r.week_start)} – ${sd(r.week_end)}` : "—") },
    { key: "carrier_name", label: "Перевозчик", type: "text", width: "minmax(120px, 1.4fr)", format: v => (v as string) || "—" },
    { key: "truck_label", label: "Машина", type: "text", width: "minmax(100px, 0.9fr)" },
    { key: "driver_label", label: "Водитель", type: "text", width: "minmax(120px, 1.4fr)" },
    { key: "trips", label: "Рейсов", type: "num", width: "64px", total: "sum" },
    { key: "gross", label: "Выручка", type: "money", width: "94px", total: "sum" },
    { key: "commission_pct", label: "% ПР", type: "pct", width: "60px", format: v => `${(v as number).toFixed(0)}%`, total: () => "—" },
    { key: "commission_rub", label: "Комиссия", type: "money", width: "94px", total: "sum" },
    { key: "net", label: "Netto", type: "money", width: "90px", total: "sum" },
    { key: "fines", label: "Штрафы", type: "money", width: "86px", total: "sum", cellTone: r => (r.fines ? "neg" : undefined) },
    { key: "toll", label: "Дорога", type: "money", width: "82px", total: "sum" },
    { key: "fuel", label: "Топливо", type: "money", width: "86px", total: "sum" },
    { key: "driver_pct", label: "% водит.", type: "pct", width: "66px", format: v => `${(v as number).toFixed(0)}%`, total: () => "—" },
    { key: "driver_payout", label: "Выплата водителю", type: "money", width: "102px", total: "sum" },
    { key: "profit", label: "Прибыль", type: "money", width: "94px", strong: true, total: "sum",
      cellTone: r => (r.profit >= 0 ? "pos" : "neg") },
    { key: "profitability", label: "Рентаб.", type: "pct", width: "70px", format: v => pctFrac(v as number | null),
      sortValue: r => (r.profitability ?? -Infinity), total: () => pctFrac(totalProfitability) },
    { key: "price_per_trip", label: "Цена рейса", type: "money", width: "90px" },
    { key: "price_per_day", label: "Цена дня", type: "money", width: "88px" },
  ];
  const columns = view === "driver" ? allColumns.filter(c => !DRIVER_HIDDEN.has(c.key)) : allColumns;

  return (
    <div className="nd">
      <NdMenu active="reports" />
      <main className="main" data-pad="wide">
        <header className="topbar">
          <div className="topbar__title">
            <h1 className="t-h1" style={{ margin: 0 }}>Отчёты</h1>
            <span className="t-mono muted">расчёт по неделям</span>
          </div>
          <div className="spacer" />
          <NdSearch value={q} onChange={setQ} placeholder="Перевозчик, машина, водитель…" />
        </header>

        <NdSectionTabs tabs={REPORTS_TABS} right={<>
          <span className="segments">
            <button className="segments__item" aria-selected={view === "full"} onClick={() => setView("full")}>Полный</button>
            <button className="segments__item" aria-selected={view === "driver"} onClick={() => setView("driver")}>Для водителя</button>
          </span>
          <button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Обычно" : "Компактно"}</button>
        </>} />

        <div className="summarystrip">
          <div className="summary"><div className="summary__label">Строк в выборке</div><div className="summary__value">{loading ? "…" : rows.length}</div></div>
          <div className="summary"><div className="summary__label">Рейсов</div><div className="summary__value">{loading ? "…" : t.trips}</div></div>
          {view === "full" && <div className="summary"><div className="summary__label">Выручка</div><div className="summary__value">{loading ? "…" : money(t.gross)}</div></div>}
          <div className="summary"><div className="summary__label">Netto (после СК)</div><div className="summary__value">{loading ? "…" : money(t.net)}</div></div>
          <div className="summary"><div className="summary__label">Штрафы</div><div className="summary__value neg">{loading ? "…" : money(t.fines)}</div></div>
          {view === "full" && <div className="summary"><div className="summary__label">Прибыль</div><div className={"summary__value" + (t.profit < 0 ? " neg" : "")}>{loading ? "…" : money(t.profit)}</div></div>}
        </div>

        <div className="filterbar">
          <NdDateRange from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
          <NdMultiSelect label="Перевозчик" options={carrierOptions} selected={carrierF} onChange={setCarrierF} />
          <NdMultiSelect label="Машина" options={truckOptions} selected={truckF} onChange={setTruckF} />
          <NdMultiSelect label="Водитель" options={driverOptions} selected={driverF} onChange={setDriverF} />
          <NdSortReset active={sorted} onReset={() => resetSortRef.current()} />
        </div>

        {data && data.notes.length > 0 && (
          <div style={{ margin: "10px 32px 0" }} className="act-warn">
            <span className="dot dot--warn" />{data.notes.join(" · ")}
          </div>
        )}

        <div className="rpt-table" style={{ flex: 1, minHeight: 0, padding: "12px 32px 20px", display: "flex", flexDirection: "column" }}>
          <NdDataTable<FlatRow>
            columns={columns} rows={rows} loading={loading} dense={dense} totals
            onSortActive={setSorted} resetRef={resetSortRef}
            sortKey="week_start" sortDir={1} rowId={r => r.id}
            empty={error ? "Не удалось загрузить отчёт" : "Нет данных за период"}
            emptyHint={error ? "Проверьте доступ и повторите" : "Смягчите фильтры или расширьте период"}
            onRowClick={r => {
              const p: Record<string, string> = { from: r.week_start, to: r.week_end };
              if (r.driver_label && r.driver_label !== "—") p.driver = r.driver_label;
              if (r.truck_plate && r.truck_plate !== "—") p.truck = r.truck_plate;
              if (r.carrier_name && r.carrier_name !== "—") p.carrier = r.carrier_name;
              navigate(`/newdash/trips?${new URLSearchParams(p).toString()}`);
            }}
          />
        </div>
      </main>
    </div>
  );
}
