// Отчёты (задача #136, 2026-06-26; выбор периода — задача #137, 2026-06-28) —
// отдельная вкладка на основе виджета "Расчёт по неделям" с Дашборда: тот же
// разрез перевозчик×машина×водитель по /api/dashboard/weekly (формулы и
// honest-оговорки — backend/app/calculations.py weekly_pnl, типы —
// ../lib/weekly.ts, общие с Dashboard.tsx), но как полноценная страница с
// фильтрами по колонкам (перевозчик/машина/водитель) и сортировкой по клику
// на заголовок столбца — то, что в узком виджете на Дашборде не нужно.
// Фильтрация и сортировка — на клиенте, по уже загруженным данным периода;
// сам период теперь выбирается тем же календарным .pill-btn, что и на
// Дашборде (см. ../components/DateRangePicker), а не честным дефолтом
// backend'а "последние 4 недели от последнего рейса" — здесь это отдельный
// отчёт с произвольным периодом, по умолчанию открывается на последних 5
// неделях (lastNWeeksRange(5), по просьбе пользователя). date_from/date_to
// передаются в /api/dashboard/weekly явно при каждом запросе.
//
// 2026-07-12 (v1.1.3): добавлена вкладка "Перевозчики" — накопительный
// баланс по перевозчикам: gross, штрафы, netto (после СК), оплачено,
// остаток. Детализация по неделям при клике на строку.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import Icon from "../components/Icon";
import MultiSelect from "../components/MultiSelect";
import DateRangePicker, { lastNWeeksRange } from "../components/DateRangePicker";
import { fmtDate, money, uniqueSorted } from "../lib/format";
import { pct, type WeeklyData, type WeeklyRow } from "../lib/weekly";
import SkeletonRows from "../components/Skeleton";

type FlatRow = WeeklyRow & { week_start: string; week_end: string };

type SortKey =
  | "period"
  | "carrier_name"
  | "truck_label"
  | "driver_label"
  | "trips"
  | "gross"
  | "commission_pct"
  | "commission_rub"
  | "net"
  | "fines"
  | "toll"
  | "fuel"
  | "driver_pct"
  | "driver_payout"
  | "trip_fines"
  | "profit"
  | "profitability"
  | "price_per_trip"
  | "price_per_day";

type SortDir = "asc" | "desc";

// «Вид» (2026-06-29, тумблер справа в строке фильтров) — режим «для
// водителя» прячет колонки с коммерческой/финансовой стороной рейса
// (выручка, % ПР, комиссия, прибыль, рентабельность, цена рейса), которые
// водителю показывать не нужно — оставляет только то, что касается его
// самого (рейсы, штрафы, дорога, топливо, % и выплата водителю).
type ReportView = "full" | "driver";
const DRIVER_HIDDEN_COLUMNS = new Set<SortKey>([
  "gross",
  "commission_pct",
  "commission_rub",
  "profit",
  "profitability",
  "price_per_trip",
  "price_per_day",
]);

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "period", label: "Период" },
  { key: "carrier_name", label: "Перевозчик" },
  { key: "truck_label", label: "Машина" },
  { key: "driver_label", label: "Водитель" },
  { key: "trips", label: "Рейсов" },
  { key: "gross", label: "Выручка" },
  { key: "commission_pct", label: "% ПР" },
  { key: "commission_rub", label: "Комиссия" },
  { key: "net", label: "Netto" },
  { key: "fines", label: "Штрафы" },
  { key: "toll", label: "Дорога" },
  { key: "fuel", label: "Топливо" },
  { key: "driver_pct", label: "% водит." },
  { key: "driver_payout", label: "Выплата водителю" },
  { key: "trip_fines", label: "Штрафы за рейсы" },
  { key: "profit", label: "Прибыль" },
  { key: "profitability", label: "Рентаб." },
  { key: "price_per_trip", label: "Цена рейса" },
  { key: "price_per_day", label: "Цена дня" },
];

function sortValue(r: FlatRow, key: SortKey): string | number {
  switch (key) {
    case "period":
      return r.week_start;
    case "carrier_name":
      return r.carrier_name || "—";
    case "truck_label":
      return r.truck_label;
    case "driver_label":
      return r.driver_label;
    case "trips":
      return r.trips;
    case "gross":
      return r.gross;
    case "commission_pct":
      return r.commission_pct;
    case "commission_rub":
      return r.commission_rub;
    case "net":
      return r.net;
    case "fines":
      return r.fines;
    case "toll":
      return r.toll;
    case "fuel":
      return r.fuel;
    case "driver_pct":
      return r.driver_pct;
    case "driver_payout":
      return r.driver_payout;
    case "trip_fines":
      return r.fines;
    case "profit":
      return r.profit;
    case "profitability":
      return r.profitability ?? -Infinity;
    case "price_per_trip":
      return r.price_per_trip;
    case "price_per_day":
      return r.price_per_day;
  }
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return null;
  return <Icon name={dir === "asc" ? "arrowup" : "arrowdown"} size={11} />;
}

// ─── Типы для вкладки «Перевозчики» ─────────────────────────────────────────

type CarrierWeek = {
  week_start: string;
  week_end: string;
  trips: number;
  gross: number;
  fines: number;
  net: number;
};

type CarrierBalanceRow = {
  carrier_name: string;
  carrier_id: number | null;
  counterparty_id: number | null;
  counterparty_name: string | null;
  trips: number;
  gross: number;
  fines: number;
  net: number;
  paid: number;
  balance: number;
  weeks: CarrierWeek[];
};

// ─── Вкладка «Перевозчики» ───────────────────────────────────────────────────

function CarriersTab() {
  const [rows, setRows] = useState<CarrierBalanceRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<CarrierBalanceRow[]>("/api/carriers/balance/")
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleExpand(name: string) {
    setExpanded((prev) => (prev === name ? null : name));
  }

  const totalTrips = useMemo(() => (rows ?? []).reduce((s, r) => s + r.trips, 0), [rows]);
  const totalGross = useMemo(() => (rows ?? []).reduce((s, r) => s + r.gross, 0), [rows]);
  const totalFines = useMemo(() => (rows ?? []).reduce((s, r) => s + r.fines, 0), [rows]);
  const totalNet = useMemo(() => (rows ?? []).reduce((s, r) => s + r.net, 0), [rows]);
  const totalPaid = useMemo(() => (rows ?? []).reduce((s, r) => s + r.paid, 0), [rows]);
  const totalBalance = useMemo(() => (rows ?? []).reduce((s, r) => s + r.balance, 0), [rows]);

  return (
    <div>
      {error && (
        <p className="fcard" style={{ color: "var(--ember)", marginBottom: 16 }}>
          {error}
        </p>
      )}

      {loading && !rows && <SkeletonRows rows={6} />}

      {rows && rows.length === 0 && (
        <p className="fcard" style={{ color: "var(--ink-3)" }}>
          Рейсов с указанием перевозчика не найдено.
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="fcard">
          <div className="tbl-scroll">
            <table>
              <thead>
                <tr>
                  <th>Перевозчик</th>
                  <th style={{ textAlign: "right" }}>Рейсов</th>
                  <th style={{ textAlign: "right" }}>Брутто</th>
                  <th style={{ textAlign: "right" }}>Штрафы</th>
                  <th style={{ textAlign: "right" }}>Netto (после СК)</th>
                  <th style={{ textAlign: "right" }}>Оплачено</th>
                  <th style={{ textAlign: "right" }}>Баланс</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <>
                    <tr
                      key={r.carrier_name}
                      style={{ cursor: "pointer" }}
                      onClick={() => toggleExpand(r.carrier_name)}
                    >
                      <td>
                        <span style={{ fontWeight: 600 }}>{r.carrier_name}</span>
                        {r.counterparty_name && (
                          <span style={{ fontSize: 12, color: "var(--ink-3)", marginLeft: 6 }}>
                            ({r.counterparty_name})
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>{r.trips}</td>
                      <td style={{ textAlign: "right" }}>{money(r.gross)}</td>
                      <td style={{ textAlign: "right", color: r.fines ? "var(--bad-ink)" : undefined }}>
                        {money(r.fines)}
                      </td>
                      <td style={{ textAlign: "right" }}>{money(r.net)}</td>
                      <td style={{ textAlign: "right", color: r.paid > 0 ? "var(--good-ink)" : undefined }}>
                        {r.paid > 0 ? money(r.paid) : "—"}
                      </td>
                      <td
                        style={{
                          textAlign: "right",
                          fontWeight: 700,
                          color: r.balance > 0 ? "var(--bad-ink)" : r.balance < 0 ? "var(--good-ink)" : undefined,
                        }}
                        title={r.balance > 0 ? "Нам должны" : r.balance < 0 ? "Мы переплатили" : undefined}
                      >
                        {money(r.balance)}
                      </td>
                      <td style={{ textAlign: "center", color: "var(--iris)" }}>
                        <Icon name={expanded === r.carrier_name ? "arrowup" : "arrowdown"} size={13} />
                      </td>
                    </tr>
                    {expanded === r.carrier_name && (
                      <tr key={r.carrier_name + "_detail"}>
                        <td colSpan={8} style={{ padding: "4px 0 16px 24px" }}>
                          <table style={{ width: "auto", minWidth: 540 }}>
                            <thead>
                              <tr>
                                <th style={{ fontSize: 12 }}>Неделя</th>
                                <th style={{ textAlign: "right", fontSize: 12 }}>Рейсов</th>
                                <th style={{ textAlign: "right", fontSize: 12 }}>Брутто</th>
                                <th style={{ textAlign: "right", fontSize: 12 }}>Штрафы</th>
                                <th style={{ textAlign: "right", fontSize: 12 }}>Netto (после СК)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.weeks.map((w) => (
                                <tr key={w.week_start}>
                                  <td style={{ whiteSpace: "nowrap" }}>
                                    {fmtDate(w.week_start)} – {fmtDate(w.week_end)}
                                  </td>
                                  <td style={{ textAlign: "right" }}>{w.trips}</td>
                                  <td style={{ textAlign: "right" }}>{money(w.gross)}</td>
                                  <td style={{ textAlign: "right", color: w.fines ? "var(--bad-ink)" : undefined }}>
                                    {w.fines ? money(w.fines) : "—"}
                                  </td>
                                  <td style={{ textAlign: "right" }}>{money(w.net)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, background: "var(--surface-2)" }}>
                  <td>Итого</td>
                  <td style={{ textAlign: "right" }}>{totalTrips}</td>
                  <td style={{ textAlign: "right" }}>{money(totalGross)}</td>
                  <td style={{ textAlign: "right" }}>{money(totalFines)}</td>
                  <td style={{ textAlign: "right" }}>{money(totalNet)}</td>
                  <td style={{ textAlign: "right" }}>{money(totalPaid)}</td>
                  <td
                    style={{
                      textAlign: "right",
                      color: totalBalance > 0 ? "var(--bad-ink)" : totalBalance < 0 ? "var(--good-ink)" : undefined,
                    }}
                  >
                    {money(totalBalance)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 12 }}>
            Баланс = накопительное Netto за всё время − поступления от связанного контрагента.
            Красный = нам должны. Зелёный = переплата.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Основной компонент Reports ───────────────────────────────────────────────

export default function Reports() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"drivers" | "carriers">("drivers");

  const [data, setData] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [carrierFilter, setCarrierFilter] = useState<Set<string>>(new Set());
  const [truckFilter, setTruckFilter] = useState<Set<string>>(new Set());
  const [driverFilter, setDriverFilter] = useState<Set<string>>(new Set());

  const [sortKey, setSortKey] = useState<SortKey>("period");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // «Вид» (2026-06-29) — по умолчанию «Полный», как и раньше.
  const [view, setView] = useState<ReportView>("full");


  // По умолчанию — последние 5 недель (задача #137, 2026-06-28)
  const [{ dateFrom: initFrom, dateTo: initTo }] = useState(() => lastNWeeksRange(5));
  const [dateFrom, setDateFrom] = useState(initFrom);
  const [dateTo, setDateTo] = useState(initTo);

  useEffect(() => {
    if (tab !== "drivers") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<WeeklyData>(`/api/dashboard/weekly?date_from=${dateFrom}&date_to=${dateTo}`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, tab]);


  const flatRows: FlatRow[] = useMemo(
    () =>
      data
        ? data.weeks.flatMap((w) => w.rows.map((r) => ({ ...r, week_start: w.week_start, week_end: w.week_end })))
        : [],
    [data]
  );

  const carrierOptions = useMemo(() => uniqueSorted(flatRows.map((r) => r.carrier_name || "—")), [flatRows]);
  const truckOptions = useMemo(() => uniqueSorted(flatRows.map((r) => r.truck_label)), [flatRows]);
  const driverOptions = useMemo(() => uniqueSorted(flatRows.map((r) => r.driver_label)), [flatRows]);

  function resetFilters() {
    setCarrierFilter(new Set());
    setTruckFilter(new Set());
    setDriverFilter(new Set());
  }

  const filteredRows = useMemo(
    () =>
      flatRows.filter(
        (r) =>
          (carrierFilter.size === 0 || carrierFilter.has(r.carrier_name || "—")) &&
          (truckFilter.size === 0 || truckFilter.has(r.truck_label)) &&
          (driverFilter.size === 0 || driverFilter.has(r.driver_label))
      ),
    [flatRows, carrierFilter, truckFilter, driverFilter]
  );

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];
    rows.sort((a, b) => {
      let va: string | number;
      let vb: string | number;
      {
        va = sortValue(a, sortKey);
        vb = sortValue(b, sortKey);
      }
      let cmp = typeof va === "string" && typeof vb === "string" ? va.localeCompare(vb, "ru") : (va as number) - (vb as number);
      if (cmp === 0) cmp = a.week_start.localeCompare(b.week_start);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [filteredRows, sortKey, sortDir]);

  const totals = useMemo(
    () =>
      filteredRows.reduce(
        (acc, r) => ({
          trips: acc.trips + r.trips,
          gross: acc.gross + r.gross,
          commission_rub: acc.commission_rub + r.commission_rub,
          net: acc.net + r.net,
          fines: acc.fines + r.fines,
          toll: acc.toll + r.toll,
          fuel: acc.fuel + r.fuel,
          driver_payout: acc.driver_payout + r.driver_payout,
          profit: acc.profit + r.profit,
        }),
        { trips: 0, gross: 0, commission_rub: 0, net: 0, fines: 0, toll: 0, fuel: 0, driver_payout: 0, profit: 0 }
      ),
    [filteredRows]
  );
  const totalsProfitability = totals.net ? totals.profit / totals.net : null;
  const filtersActive = carrierFilter.size > 0 || truckFilter.size > 0 || driverFilter.size > 0;
  const visibleColumns = view === "driver" ? COLUMNS.filter((c) => !DRIVER_HIDDEN_COLUMNS.has(c.key)) : COLUMNS;

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div>
      <div className="pagehead">
        <div className="ph-title">
          <div className="crumbs">
            <Icon name="grid" size={13} /> Автопарк <Icon name="chevr" size={13} /> Расчёт по неделям
          </div>
          <h1 className="pagetitle">Отчёты</h1>
        </div>
        {tab === "drivers" && (
          <div className="head-actions">
            <DateRangePicker
              dateFrom={dateFrom}
              dateTo={dateTo}
              onChange={(f, t) => {
                setDateFrom(f);
                setDateTo(t);
              }}
            />
          </div>
        )}
      </div>

      {/* Вкладки: Водители / Перевозчики */}
      <div className="navpills" style={{ marginBottom: 20, width: "fit-content" }}>
        <button
          type="button"
          className={"navpill" + (tab === "drivers" ? " active" : "")}
          style={{ border: "none", background: tab === "drivers" ? undefined : "none", cursor: "pointer", font: "inherit" }}
          onClick={() => setTab("drivers")}
        >
          Водители
        </button>
        <button
          type="button"
          className={"navpill" + (tab === "carriers" ? " active" : "")}
          style={{ border: "none", background: tab === "carriers" ? undefined : "none", cursor: "pointer", font: "inherit" }}
          onClick={() => setTab("carriers")}
        >
          Перевозчики
        </button>
      </div>

      {tab === "carriers" && <CarriersTab />}

      {tab === "drivers" && (
        <>
          {error && (
            <p className="fcard" style={{ color: "var(--ember)", marginBottom: 16 }}>
              {error}
            </p>
          )}

          <div className="fcard" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
              <MultiSelect label="Перевозчик" options={carrierOptions} selected={carrierFilter} onChange={setCarrierFilter} />
              <MultiSelect label="Машина" options={truckOptions} selected={truckFilter} onChange={setTruckFilter} />
              <MultiSelect label="Водитель" options={driverOptions} selected={driverFilter} onChange={setDriverFilter} />
              {filtersActive && (
                <button type="button" className="btn btn-ghost" style={{ fontSize: 13, padding: "9px 16px" }} onClick={resetFilters}>
                  Сбросить фильтры
                </button>
              )}
              <div className="navpills" style={{ width: "fit-content", marginLeft: "auto" }}>
                <button
                  type="button"
                  className={"navpill" + (view === "full" ? " active" : "")}
                  style={{ border: "none", background: view === "full" ? undefined : "none", cursor: "pointer", font: "inherit" }}
                  onClick={() => setView("full")}
                >
                  Полный
                </button>
                <button
                  type="button"
                  className={"navpill" + (view === "driver" ? " active" : "")}
                  style={{ border: "none", background: view === "driver" ? undefined : "none", cursor: "pointer", font: "inherit" }}
                  onClick={() => setView("driver")}
                >
                  Для водителя
                </button>
              </div>
            </div>
          </div>

          {loading && !data && <SkeletonRows rows={9} />}

          {data && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                <span className="badge">
                  <Icon name="calendar" size={14} /> {fmtDate(data.period.date_from)} – {fmtDate(data.period.date_to)}
                </span>
                <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
                  {sortedRows.length} из {flatRows.length} строк
                </span>
              </div>

              {sortedRows.length === 0 && (
                <p className="fcard" style={{ color: "var(--ink-3)" }}>
                  Нет данных по выбранным фильтрам.
                </p>
              )}

              {sortedRows.length > 0 && (
                <div className="fcard">
                  <div className="tbl-scroll">
                    <table>
                      <thead>
                        <tr>
                          {visibleColumns.map((c) => (
                            <th
                              key={c.key}
                              className="sortable-th"
                              onClick={() => toggleSort(c.key)}
                              title="Сортировать"
                              style={{ color: sortKey === c.key ? "var(--ink)" : undefined }}
                            >
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                {c.label}
                                <SortIcon active={sortKey === c.key} dir={sortDir} />
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRows.map((r, i) => (
                          <tr key={`${r.week_start}-${r.truck_id}-${r.driver_id}-${i}`}>
                            <td
                              style={{ cursor: "pointer", color: "var(--iris)", whiteSpace: "nowrap" }}
                              title="Открыть рейсы за этот период"
                              onClick={() => {
                                const p: Record<string, string> = {
                                  from: r.week_start,
                                  to: r.week_end,
                                };
                                if (r.driver_label && r.driver_label !== "—") p.driver = r.driver_label;
                                if (r.truck_plate && r.truck_plate !== "—") p.truck = r.truck_plate;
                                if (r.carrier_name && r.carrier_name !== "—") p.carrier = r.carrier_name;
                                navigate(`/trips?${new URLSearchParams(p).toString()}`);
                              }}
                            >
                              {fmtDate(r.week_start)} – {fmtDate(r.week_end)}
                            </td>
                            <td>{r.carrier_name || "—"}</td>
                            <td>{r.truck_label}</td>
                            <td>{r.driver_label}</td>
                            <td>{r.trips}</td>
                            {view === "full" && <td>{money(r.gross)}</td>}
                            {view === "full" && <td>{r.commission_pct.toFixed(0)}%</td>}
                            {view === "full" && <td>{money(r.commission_rub)}</td>}
                            <td>{money(r.net)}</td>
                            <td style={{ color: r.fines ? "var(--bad-ink)" : undefined }}>{money(r.fines)}</td>
                            <td>{money(r.toll)}</td>
                            <td>{money(r.fuel)}</td>
                            <td>{r.driver_pct.toFixed(0)}%</td>
                            <td>{money(r.driver_payout)}</td>
                            <td style={{ color: r.fines ? "var(--bad-ink)" : undefined }}>
                              {money(r.fines)}
                            </td>
                            {view === "full" && (
                              <td style={{ color: r.profit >= 0 ? "var(--good-ink)" : "var(--bad-ink)", fontWeight: 700 }}>
                                {money(r.profit)}
                              </td>
                            )}
                            {view === "full" && <td>{pct(r.profitability)}</td>}
                            {view === "full" && <td>{money(r.price_per_trip)}</td>}
                            {view === "full" && <td title={`${r.work_days} раб. дн.`}>{money(r.price_per_day)}</td>}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ fontWeight: 700, background: "var(--surface-2)" }}>
                          <td>Итого</td>
                          <td colSpan={3}>{filtersActive ? "по фильтру" : "за весь период"}</td>
                          <td>{totals.trips}</td>
                          {view === "full" && <td>{money(totals.gross)}</td>}
                          {view === "full" && <td>—</td>}
                          {view === "full" && <td>{money(totals.commission_rub)}</td>}
                          <td>{money(totals.net)}</td>
                          <td style={{ color: totals.fines ? "var(--bad-ink)" : undefined }}>{money(totals.fines)}</td>
                          <td>{money(totals.toll)}</td>
                          <td>{money(totals.fuel)}</td>
                          <td>—</td>
                          <td>{money(totals.driver_payout)}</td>
                          <td style={{ color: totals.fines ? "var(--bad-ink)" : undefined }}>{money(totals.fines)}</td>
                          {view === "full" && (
                            <td style={{ color: totals.profit >= 0 ? "var(--good-ink)" : "var(--bad-ink)" }}>
                              {money(totals.profit)}
                            </td>
                          )}
                          {view === "full" && <td>{pct(totalsProfitability)}</td>}
                          {view === "full" && <td>—</td>}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {data.notes.length > 0 && (
                <div className="fcard" style={{ fontSize: "0.82rem", color: "var(--ink-3)", lineHeight: 1.5, marginTop: 16 }}>
                  {data.notes.map((n, i) => (
                    <div key={i} style={{ marginBottom: i < data.notes.length - 1 ? 6 : 0 }}>
                      ⚠ {n}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

    </div>
  );
}
