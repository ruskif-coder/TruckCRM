// Живой дашборд — переписан 2026-06-26 (задача #55) под GET /api/dashboard/.
// Старый статичный Huly-макет сохранён как DashboardDemo.tsx (/dashboard-demo,
// см. навигацию "Демо-дашборд") — карточная сетка (.fcard/.a-feat/.a-act/
// .a-stat/.a-fuel/.a-struct) та же, но каждая секция теперь показывает то,
// что реально есть в БД: рейсы (Trip), топливо (FuelRecord), денежный поток
// (CashFlowEntry). "Структура парка" (Donut) стала разбивкой расходов по
// категориям; "Сейчас в рейсе" (мятная карточка) — честной сводкой "сегодня"
// по Trip.dep_at/end_at (нет live-GPS, не выдумываем). Нет единой "прибыли" —
// у Trip нет commission_pct/driver_pay (задача #103), поэтому выручка/штрафы
// по рейсам и доход/расход по кэшфлоу показаны раздельно (см. docstring
// backend/app/routers/dashboard.py, почему их нельзя просто сложить).
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import Icon from "../components/Icon";
import BarChart, { type BarChartDay } from "../components/charts/BarChart";
import AreaChart from "../components/charts/AreaChart";
import Donut from "../components/charts/Donut";
import DateRangePicker, { defaultWeekRange } from "../components/DateRangePicker";
import { fmtDate, money, moneyWhole } from "../lib/format";
import { pct, type WeeklyData } from "../lib/weekly";

type Kpi = {
  trips_count: number;
  trips_count_prev: number;
  revenue: number;
  revenue_prev: number;
  fines: number;
  fines_prev: number;
  fuel_cost: number;
  fuel_cost_prev: number;
};
type ByTruck = { truck_id: number; label: string; trips_count: number; revenue: number; fines: number };
type FuelTrend = {
  days: number[];
  // Литры по тем же неделям, что и days (2026-06-28, подсказка при наведении).
  volumes: number[];
  labels: string[];
  peak_idx: number;
  peak_label: string;
  total: number;
};
type Trend = { trips: BarChartDay[]; trips_total: number; fuel: FuelTrend };
type Today = { active_trips: number; active_trucks: number; active_drivers: number; departed_today: number };
type CashflowCat = { category: string; value: number };
type Cashflow = { income: number; expense: number; net: number; by_category: CashflowCat[] };
type Alert = { level: "bad" | "warn"; message: string; href?: string };
type ExpiryItem = {
  entity_type: "truck" | "driver";
  entity_label: string;
  doc_type: string;
  days_left: number;
  level: "expired" | "critical" | "warn" | "notice";
};
type DashboardData = {
  period: { date_from: string; date_to: string };
  kpi: Kpi;
  by_truck: ByTruck[];
  trend: Trend;
  today: Today;
  cashflow: Cashflow;
  alerts: Alert[];
  fleet_size: number;
};

// Расчёт по неделям (задача #129) — разрез перевозчик×машина×водитель по
// логике TCargo 2025.xlsx ("Сводная OZON"). Типы (WeeklyRow/WeeklyData/...) и
// формулы — см. ../lib/weekly.ts и backend/app/calculations.py (weekly_pnl);
// honest-оговорки про % водителя/комиссию/платную дорогу — там же и в
// backend/app/routers/dashboard.py (WEEKLY_NOTES). Тот же эндпоинт и типы
// переиспользует страница "Отчёты" (Reports.tsx, задача #136) с фильтрами по
// колонкам и сортировкой — здесь, в узком виджете на Дашборде, это избыточно.

const DONUT_COLORS = ["var(--accent)", "var(--bad)", "var(--warn)", "var(--good)", "var(--iris)", "var(--ink-3)"];

function pctDelta(curr: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((curr - prev) / prev) * 100);
}

// invert=true для метрик, где рост — это плохо (штрафы, топливо): стрелка
// всегда показывает фактическое направление, а цвет (good/bad) — оценку.
function Delta({ curr, prev, invert = false }: { curr: number; prev: number; invert?: boolean }) {
  const pct = pctDelta(curr, prev);
  if (pct === null) return null;
  const up = pct >= 0;
  const good = invert ? !up : up;
  return (
    <span className="delta" style={{ color: good ? "var(--good-ink)" : "var(--bad-ink)" }}>
      <Icon name={up ? "arrowup" : "arrowdown"} size={13} /> {Math.abs(pct)}%
    </span>
  );
}

const fmtShort = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m ? `${d}.${m}.${y.slice(2)}` : iso;
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expiryItems, setExpiryItems] = useState<ExpiryItem[]>([]);

  // По умолчанию — текущая неделя (см. DateRangePicker.defaultWeekRange),
  // как и сам элемент дизайна в пейджхеде ниже; другие периоды выбираются
  // там же из выпадающего списка.
  const [{ dateFrom: initFrom, dateTo: initTo }] = useState(defaultWeekRange);
  const [dateFrom, setDateFrom] = useState(initFrom);
  const [dateTo, setDateTo] = useState(initTo);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [result, expiry] = await Promise.all([
        api.get<DashboardData>(`/api/dashboard/?date_from=${dateFrom}&date_to=${dateTo}`),
        api.get<{ items: ExpiryItem[] }>("/api/dashboard/expiring-docs").catch(() => ({ items: [] })),
      ]);
      setData(result);
      setExpiryItems(expiry.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  if (loading && !data) {
    return <p style={{ color: "var(--smoke)" }}>Загрузка...</p>;
  }
  if (error && !data) {
    return (
      <p className="fcard" style={{ color: "var(--ember)" }}>
        {error}
      </p>
    );
  }
  if (!data) return null;

  const { kpi, by_truck, trend, today, cashflow, alerts, fleet_size } = data;

  const expiryAlerts: Alert[] = expiryItems.map((item) => ({
    level: item.level === "expired" || item.level === "critical" ? "bad" : "warn",
    message: `${item.entity_label} — ${item.doc_type}: ${
      item.days_left < 0
        ? `просрочен ${Math.abs(item.days_left)} дн.`
        : item.days_left === 0
        ? "истекает сегодня"
        : `осталось ${item.days_left} дн.`
    }`,
    href: item.entity_type === "truck" ? "/directory?tab=vehicles" : "/directory?tab=drivers",
  }));
  const allAlerts = [...expiryAlerts, ...alerts];
  const topTrucks = by_truck.slice(0, 3);
  const donutSegments = cashflow.by_category
    .slice(0, 6)
    .map((c, i) => ({ name: c.category, count: c.value, color: DONUT_COLORS[i % DONUT_COLORS.length] }));

  const lastWeekTrips = trend.trips[trend.trips.length - 1]?.v ?? 0;
  const prevWeekTrips = trend.trips[trend.trips.length - 2]?.v ?? 0;
  const lastWeekFuel = trend.fuel.days[trend.fuel.days.length - 1] ?? 0;
  const prevWeekFuel = trend.fuel.days[trend.fuel.days.length - 2] ?? 0;

  return (
    <div>
      {/* Страница теперь сама рисует свой .pagehead (с рабочим выбором дат
          в календарном .pill-btn), а не через AppShell-овский META-хедер —
          см. AppShell.tsx, запись "/" там убрана (2026-06-26). */}
      <div className="pagehead">
        <div className="ph-title">
          <div className="crumbs">
            <Icon name="grid" size={13} /> Автопарк <Icon name="chevr" size={13} /> Обзор парка
          </div>
          <h1 className="pagetitle">Панель управления</h1>
        </div>
        <div className="head-actions">
          <button className="pill-btn round" title="Поиск">
            <Icon name="search" size={18} />
          </button>
          <button className="pill-btn round desk-only" title="Фильтр">
            <Icon name="filter" size={18} />
          </button>
          <DateRangePicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={(f, t) => {
              setDateFrom(f);
              setDateTo(t);
            }}
          />
        </div>
      </div>
      {error && (
        <div className="fcard" style={{ marginBottom: 16, color: "var(--ember)", fontSize: 13 }}>
          {error}
        </div>
      )}

      <div className="grid">
        {/* Featured */}
        <section className="fcard a-feat">
          <div className="feat-top">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="badge">
                <Icon name="calendar" size={15} /> {fmtShort(data.period.date_from)}–{fmtShort(data.period.date_to)}
              </span>
            </div>
            <div style={{ marginTop: 24, color: "var(--ink-2)", fontWeight: 700, fontSize: "1.05rem" }}>Выручка за период</div>
            <div className="feat-hero">
              <span className="big">{kpi.revenue.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}</span>
              <span className="unit">₽</span>
            </div>
            <div className="statline">
              <div className="statrow">
                <span className="sd" style={{ background: "var(--good)" }} />
                <span className="lbl">Рейсов</span>
                <span className="v">
                  {kpi.trips_count} <Delta curr={kpi.trips_count} prev={kpi.trips_count_prev} />
                </span>
              </div>
              <div className="statrow">
                <span className="sd" style={{ background: "var(--bad)" }} />
                <span className="lbl">Штрафы</span>
                <span className="v">
                  {money(kpi.fines)} <Delta curr={kpi.fines} prev={kpi.fines_prev} invert />
                </span>
              </div>
              <div className="statrow">
                <span className="sd" style={{ background: "var(--warn)" }} />
                <span className="lbl">Топливо</span>
                <span className="v">
                  {money(kpi.fuel_cost)} <Delta curr={kpi.fuel_cost} prev={kpi.fuel_cost_prev} invert />
                </span>
              </div>
            </div>
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
              <div
                style={{
                  color: "var(--ink-3)",
                  fontWeight: 700,
                  fontSize: "0.78rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  marginBottom: 12,
                }}
              >
                Требует внимания
              </div>
              {allAlerts.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 11,
                      background: "var(--surface-2)",
                      display: "grid",
                      placeItems: "center",
                      color: "var(--good-ink)",
                      flex: "0 0 auto",
                    }}
                  >
                    <Icon name="route" size={17} />
                  </span>
                  <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>Нет просроченных ТО и документов</div>
                </div>
              ) : (
                <div style={{ maxHeight: 220, overflowY: "auto", marginRight: -4, paddingRight: 4 }}>
                {allAlerts.map((a, i) => {
                  const inner = (
                    <>
                      <span
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 11,
                          background: "var(--surface-2)",
                          display: "grid",
                          placeItems: "center",
                          color: a.level === "bad" ? "var(--bad-ink)" : "var(--warn-ink)",
                          flex: "0 0 auto",
                        }}
                      >
                        <Icon name={a.level === "bad" ? "bell" : "wrench"} size={17} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: "0.88rem" }}>{a.message}</div>
                    </>
                  );
                  const wrapStyle: React.CSSProperties = {
                    display: "flex", alignItems: "center", gap: 11,
                    marginBottom: i < allAlerts.length - 1 ? 12 : 0,
                    ...(a.href ? { borderRadius: 8, padding: "4px 0", textDecoration: "none", color: "inherit" } : {}),
                  };
                  return a.href ? (
                    <Link key={i} to={a.href} style={wrapStyle}>{inner}</Link>
                  ) : (
                    <div key={i} style={wrapStyle}>{inner}</div>
                  );
                })}
                </div>
              )}
            </div>
          </div>
          <div className="nested">
            <div className="nested-head">
              <span className="t">Топ машин за период</span>
              <span className="num" style={{ fontWeight: 600, fontSize: "1.05rem" }}>
                {by_truck.length} <span style={{ color: "var(--ink-3)", fontSize: "0.8rem" }}>в работе</span>
              </span>
            </div>
            {topTrucks.length === 0 ? (
              <p style={{ color: "var(--ink-3)", fontSize: "0.85rem", margin: "12px 0" }}>Нет рейсов за выбранный период</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "12px 0" }}>
                {topTrucks.map((t) => (
                  <div key={t.truck_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>{t.label}</span>
                    <span className="num" style={{ fontWeight: 700, fontSize: "0.9rem" }}>
                      {money(t.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Link className="cta" to="/trips">
              Все рейсы{" "}
              <span className="arr">
                <Icon name="arrowdr" size={16} />
              </span>
            </Link>
          </div>
        </section>

        {/* Activity / рейсы */}
        <section className="fcard a-act">
          <div className="card-head">
            <div>
              <div className="card-title">Рейсы по неделям</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="bignum">
              <span className="n">{trend.trips_total}</span>
              <span className="s">за 8 недель</span>
            </div>
            <Delta curr={lastWeekTrips} prev={prevWeekTrips} />
          </div>
          <BarChart days={trend.trips} />
        </section>

        {/* Today (mint) */}
        <section className="fcard a-stat">
          <div className="card-head">
            <div className="card-title">Сегодня</div>
            <button className="chip-ic">
              <Icon name="route" size={16} />
            </button>
          </div>
          <div className="mintcard">
            <div className="row">
              <span className="plate">В пути сейчас</span>
              <Icon name="truck" size={26} />
            </div>
            <div style={{ marginTop: 10 }} className="sub">
              Активных рейсов
            </div>
            <div className="km">{today.active_trips}</div>
          </div>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--ink-3)", fontWeight: 600, fontSize: "0.84rem" }}>Машин в пути</span>
              <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{today.active_trucks}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--ink-3)", fontWeight: 600, fontSize: "0.84rem" }}>Водителей в пути</span>
              <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{today.active_drivers}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--ink-3)", fontWeight: 600, fontSize: "0.84rem" }}>Выехало сегодня</span>
              <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{today.departed_today}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--ink-3)", fontWeight: 600, fontSize: "0.84rem" }}>Машин в парке</span>
              <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{fleet_size}</span>
            </div>
          </div>
        </section>

        {/* Fuel area */}
        <section className="fcard a-fuel">
          <div className="card-head">
            <div className="card-title">Расход топлива по неделям</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="bignum">
              <span className="n">₽{trend.fuel.total.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}</span>
            </div>
            <Delta curr={lastWeekFuel} prev={prevWeekFuel} invert />
            <span style={{ color: "var(--ink-3)", fontWeight: 600, fontSize: "0.82rem" }}>за 8 недель</span>
          </div>
          <AreaChart
            values={trend.fuel.days}
            volumes={trend.fuel.volumes}
            peakIdx={trend.fuel.peak_idx}
            peakLabel={trend.fuel.peak_label}
            labels={trend.fuel.labels}
          />
        </section>

        {/* Cashflow structure donut */}
        <section className="fcard a-struct">
          <div className="card-head">
            <div className="card-title">Структура расходов</div>
            <Link className="chip-ic" to="/expenses">
              <Icon name="expand" size={16} />
            </Link>
          </div>
          {donutSegments.length === 0 ? (
            <p style={{ color: "var(--ink-3)", fontSize: "0.85rem" }}>Нет операций по денежному потоку за период</p>
          ) : (
            <Donut segments={donutSegments} centerLabel="расходы" centerValue={moneyWhole(cashflow.expense)} valueFontSize={13} />
          )}
          {/* 2026-06-28: без копеек + чуть меньший шрифт - только в этом виджете
              (moneyWhole + инлайн fontSize переопределяет .foot3 .f .n из
              styles.css), остальной дашборд и DashboardDemo.tsx не трогаем. */}
          <div className="foot3">
            <div className="f">
              <div className="n" style={{ fontSize: "1.32rem" }}>
                {moneyWhole(cashflow.income)}
              </div>
              <div className="l">Поступления</div>
            </div>
            <div className="f">
              <div className="n" style={{ fontSize: "1.32rem" }}>
                {moneyWhole(cashflow.expense)}
              </div>
              <div className="l">Списания</div>
            </div>
            <div className="f">
              <div
                className="n"
                style={{ fontSize: "1.32rem", color: cashflow.net >= 0 ? "var(--good-ink)" : "var(--bad-ink)" }}
              >
                {moneyWhole(cashflow.net)}
              </div>
              <div className="l">Сальдо</div>
            </div>
          </div>
        </section>
      </div>

      <WeeklyBreakdown />
    </div>
  );
}

function WeeklyBreakdown() {
  const [data, setData] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<WeeklyData>(`/api/dashboard/weekly`)
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
  }, []);

  const grand = data
    ? data.weeks.reduce(
        (acc, w) => ({
          trips: acc.trips + w.totals.trips,
          gross: acc.gross + w.totals.gross,
          commission_rub: acc.commission_rub + w.totals.commission_rub,
          net: acc.net + w.totals.net,
          fines: acc.fines + w.totals.fines,
          toll: acc.toll + w.totals.toll,
          fuel: acc.fuel + w.totals.fuel,
          driver_payout: acc.driver_payout + w.totals.driver_payout,
          profit: acc.profit + w.totals.profit,
        }),
        { trips: 0, gross: 0, commission_rub: 0, net: 0, fines: 0, toll: 0, fuel: 0, driver_payout: 0, profit: 0 }
      )
    : null;
  const grandProfitability = grand && grand.net ? grand.profit / grand.net : null;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: 0, color: "var(--ink)" }}>Расчёт по неделям</h2>
        {data && (
          <span className="badge">
            <Icon name="calendar" size={14} /> последние 4 недели: {fmtDate(data.period.date_from)} – {fmtDate(data.period.date_to)}
          </span>
        )}
      </div>

      {loading && !data && <p style={{ color: "var(--smoke)" }}>Загрузка...</p>}
      {error && (
        <p className="fcard" style={{ color: "var(--ember)" }}>
          {error}
        </p>
      )}
      {data && data.weeks.length === 0 && (
        <p className="fcard" style={{ color: "var(--ink-3)" }}>
          Нет рейсов за выбранный период.
        </p>
      )}

      {data && data.weeks.length > 0 && grand && (
        <div className="fcard">
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Период</th>
                  <th>Перевозчик</th>
                  <th>Машина</th>
                  <th>Водитель</th>
                  <th>Рейсов</th>
                  <th>Выручка</th>
                  <th>% ПР</th>
                  <th>Комиссия</th>
                  <th>Netto</th>
                  <th>Штрафы</th>
                  <th>Дорога</th>
                  <th>Топливо</th>
                  <th>% водит.</th>
                  <th>Выплата водителю</th>
                  <th>Прибыль</th>
                  <th>Рентаб.</th>
                  <th>Цена рейса</th>
                </tr>
              </thead>
              <tbody>
                {data.weeks.flatMap((w) => {
                  const period = `${fmtDate(w.week_start)} – ${fmtDate(w.week_end)}`;
                  return w.rows.map((r, i) => (
                    <tr key={`${w.week_start}-${i}`}>
                      <td>{period}</td>
                      <td>{r.carrier_name || "—"}</td>
                      <td>{r.truck_label}</td>
                      <td>{r.driver_label}</td>
                      <td>{r.trips}</td>
                      <td>{money(r.gross)}</td>
                      <td>{r.commission_pct.toFixed(0)}%</td>
                      <td>{money(r.commission_rub)}</td>
                      <td>{money(r.net)}</td>
                      <td style={{ color: r.fines ? "var(--bad-ink)" : undefined }}>{money(r.fines)}</td>
                      <td>{money(r.toll)}</td>
                      <td>{money(r.fuel)}</td>
                      <td>{r.driver_pct.toFixed(0)}%</td>
                      <td>{money(r.driver_payout)}</td>
                      <td style={{ color: r.profit >= 0 ? "var(--good-ink)" : "var(--bad-ink)", fontWeight: 700 }}>
                        {money(r.profit)}
                      </td>
                      <td>{pct(r.profitability)}</td>
                      <td>{money(r.price_per_trip)}</td>
                    </tr>
                  ));
                })}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 700, background: "var(--surface-2)" }}>
                  <td>Итого</td>
                  <td colSpan={3}>за весь период</td>
                  <td>{grand.trips}</td>
                  <td>{money(grand.gross)}</td>
                  <td>—</td>
                  <td>{money(grand.commission_rub)}</td>
                  <td>{money(grand.net)}</td>
                  <td style={{ color: grand.fines ? "var(--bad-ink)" : undefined }}>{money(grand.fines)}</td>
                  <td>{money(grand.toll)}</td>
                  <td>{money(grand.fuel)}</td>
                  <td>—</td>
                  <td>{money(grand.driver_payout)}</td>
                  <td style={{ color: grand.profit >= 0 ? "var(--good-ink)" : "var(--bad-ink)" }}>
                    {money(grand.profit)}
                  </td>
                  <td>{pct(grandProfitability)}</td>
                  <td>—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {data && data.notes.length > 0 && (
        <div className="fcard" style={{ fontSize: "0.82rem", color: "var(--ink-3)", lineHeight: 1.5 }}>
          {data.notes.map((n, i) => (
            <div key={i} style={{ marginBottom: i < data.notes.length - 1 ? 6 : 0 }}>
              ⚠ {n}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
