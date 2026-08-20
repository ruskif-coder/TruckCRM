/**
 * NewDashReportsSummary — вкладка «Отчёты → Сводка по неделям»
 * (/newdash/reports/summary). Сводные суммы по неделям БЕЗ разбивки на машины и
 * водителей + «чистый денежный поток»:
 *   Чистый = Netto − Штрафы − Топливо − Выплаты водителям − Прочие расходы.
 * Топливо и выплаты берём из расчёта (weekly_pnl.totals), «прочие расходы» —
 * реестр CashFlow за неделю без категорий «Топливо» и «Расчёт с водителем»
 * (бэкенд считает registry_other_expense/clean_flow в /api/dashboard/weekly).
 * Оформление — контур .nd, как остальные вкладки Отчётов.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import { isoDate, money } from "../../lib/format";
import type { WeeklyData, WeeklyTotals } from "../../lib/weekly";
import NdMenu from "./NdMenu";
import NdSectionTabs, { REPORTS_TABS } from "./NdSectionTabs";
import NdDateRange from "./NdDateRange";
import NdSortReset from "./NdSortReset";
import NdFilters, { NdFilterButton } from "./NdFilters";
import NdPhoneHead from "./NdPhoneHead";
import NdDataTable from "./NdDataTable";
import type { Column } from "./NdDataTable";
import { shortDate as sd, NdSearch, useIsPhone } from "./shared";
import "./newdash.css";

type WeekRow = WeeklyTotals & { week_start: string; week_end: string; id: string };

// Номер ISO-недели по дате (для подписи «Нxx»).
function isoWeek(iso: string): number {
  const d = new Date(iso + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;               // пн=0
  d.setUTCDate(d.getUTCDate() - day + 3);            // четверг этой недели
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const ftDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - ftDay + 3);  // четверг 1-й недели года
  return 1 + Math.round((d.getTime() - firstThu.getTime()) / (7 * 86400000));
}

export default function NewDashReportsSummary() {
  const [data, setData] = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dense, setDense] = useState(true);
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});
  const isPhone = useIsPhone();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // По умолчанию — ВСЯ история (dateFrom пусто → бэкенд отдаёт от первого рейса).
  // После первой загрузки подставляем реальную дату старта в пикер, чтобы можно
  // было сузить период вручную.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState(() => isoDate(new Date()));
  const rangeInit = useRef(false);
  const isNarrowed = !!dateFrom && rangeInit.current && dateFrom !== (data?.period.date_from ?? "");
  const activeCount = (sorted ? 1 : 0) + (isNarrowed ? 1 : 0);
  const resetAllFilters = () => { setDateFrom(data?.period.date_from ?? ""); setDateTo(isoDate(new Date())); resetSortRef.current(); };

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    const p = new URLSearchParams();
    p.set("date_to", dateTo);
    if (dateFrom) p.set("date_from", dateFrom);
    api.get<WeeklyData>(`/api/dashboard/weekly?${p.toString()}`)
      .then(r => {
        if (cancelled) return;
        setData(r);
        if (!rangeInit.current && !dateFrom && r.period?.date_from) { rangeInit.current = true; setDateFrom(r.period.date_from); }
      })
      .catch(err => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Ошибка загрузки"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateFrom, dateTo]);

  const rows: WeekRow[] = useMemo(() => {
    const all = (data?.weeks ?? []).map(w => ({ ...w.totals, week_start: w.week_start, week_end: w.week_end, id: w.week_start }));
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter(w => `Н${isoWeek(w.week_start)} ${sd(w.week_start)} ${sd(w.week_end)}`.toLowerCase().includes(s));
  }, [data, q]);

  const t = useMemo(() => rows.reduce((a, r) => ({
    trips: a.trips + r.trips, net: a.net + r.net, fines: a.fines + r.fines, fuel: a.fuel + r.fuel,
    driver_payout: a.driver_payout + r.driver_payout, other: a.other + r.registry_other_expense, clean: a.clean + r.clean_flow,
  }), { trips: 0, net: 0, fines: 0, fuel: 0, driver_payout: 0, other: 0, clean: 0 }), [rows]);

  const columns: Column<WeekRow>[] = [
    { key: "week_start", label: "Неделя", type: "date", width: "minmax(150px, 1fr)", sticky: true, strong: true,
      format: (_, r) => (r ? `Н${isoWeek(r.week_start)} · ${sd(r.week_start)}–${sd(r.week_end)}` : "—") },
    { key: "trips", label: "Рейсов", type: "num", width: "72px", total: "sum" },
    { key: "net", label: "Netto", type: "money", width: "104px", total: "sum" },
    { key: "fines", label: "Штрафы", type: "money", width: "98px", total: "sum", cellTone: r => (r.fines ? "neg" : undefined) },
    { key: "fuel", label: "Топливо", type: "money", width: "98px", total: "sum" },
    { key: "driver_payout", label: "Выплаты вод.", type: "money", width: "110px", total: "sum" },
    { key: "registry_other_expense", label: "Проч. расходы", type: "money", width: "110px", total: "sum" },
    { key: "clean_flow", label: "Чистый поток", type: "money", width: "116px", strong: true, total: "sum",
      cellTone: r => (r.clean_flow >= 0 ? "pos" : "neg") },
  ];

  return (
    <div className="nd">
      <NdMenu active="reports" />
      <main className="main" data-pad="wide">
        {isPhone ? (
          <>
            <NdPhoneHead title="Сводка по неделям" subtitle="чистый денежный поток" />
            <NdSectionTabs tabs={REPORTS_TABS} />
            <div className="nd-searchrow">
              <NdSearch value={q} onChange={setQ} placeholder="Неделя…" />
              <NdFilterButton count={activeCount} onClick={() => setFiltersOpen(true)} />
            </div>
          </>
        ) : (
          <>
            <header className="topbar">
              <div className="topbar__title">
                <h1 className="t-h1" style={{ margin: 0 }}>Сводка по неделям</h1>
                <span className="t-mono muted">чистый денежный поток</span>
              </div>
              <div className="spacer" />
              <NdSearch value={q} onChange={setQ} placeholder="Неделя…" />
            </header>
            <NdSectionTabs tabs={REPORTS_TABS} right={
              <button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Обычно" : "Компактно"}</button>
            } />
          </>
        )}

        <div className="summarystrip">
          <div className="summary"><div className="summary__label">Недель</div><div className="summary__value">{loading ? "…" : rows.length}</div></div>
          <div className="summary"><div className="summary__label">Netto</div><div className="summary__value">{loading ? "…" : money(t.net)}</div></div>
          <div className="summary"><div className="summary__label">Расходы (топл.+вод.+проч.)</div><div className="summary__value neg">{loading ? "…" : money(t.fuel + t.driver_payout + t.other)}</div></div>
          <div className="summary"><div className="summary__label">Чистый поток</div><div className={"summary__value" + (t.clean < 0 ? " neg" : "")} style={t.clean >= 0 ? { color: "var(--success-strong)" } : undefined}>{loading ? "…" : money(t.clean)}</div></div>
        </div>

        <NdFilters open={filtersOpen} onClose={() => setFiltersOpen(false)} onReset={resetAllFilters} section="Сводка">
          <NdDateRange from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
          <NdSortReset active={sorted} onReset={() => resetSortRef.current()} />
        </NdFilters>

        <div className={isPhone ? "nd-listwrap" : "rpt-table"} style={isPhone ? undefined : { flex: 1, minHeight: 0, padding: "12px 32px 20px", display: "flex", flexDirection: "column" }}>
          <NdDataTable<WeekRow>
            columns={columns} rows={rows} loading={loading} dense={dense} totals
            onSortActive={setSorted} resetRef={resetSortRef}
            sortKey="week_start" sortDir={1} rowId={r => r.id}
            card={r => ({
              title: `Н${isoWeek(r.week_start)} · ${sd(r.week_start)}–${sd(r.week_end)}`,
              subtitle: `${r.trips} рейс.`,
              right: <><div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: r.clean_flow >= 0 ? "var(--success-strong)" : "var(--danger)" }}>{money(r.clean_flow)}</div><div className="t-mono-label" style={{ textAlign: "right", marginTop: 2 }}>чистый поток</div></>,
              collapsible: true,
              facts: [
                { label: "Netto", value: money(r.net) },
                { label: "Штрафы", value: money(r.fines) },
                { label: "Топливо", value: money(r.fuel) },
                { label: "Выплаты вод.", value: money(r.driver_payout) },
                { label: "Проч. расходы", value: money(r.registry_other_expense) },
              ],
            })}
            empty={error ? "Не удалось загрузить" : "Нет данных за период"}
            emptyHint={error ? "Проверьте доступ и повторите" : "Расширьте период"}
          />
        </div>
      </main>
    </div>
  );
}
