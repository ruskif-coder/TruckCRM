/**
 * NewDashCarriers — вкладка «Перевозчики» раздела «Отчёты» (/newdash/reports/carriers).
 * Порт CarriersTab из старой Reports.tsx: накопительный баланс по перевозчикам
 * (gross, штрафы, netto после СК, оплачено, остаток) по /api/carriers/balance/,
 * детализация по неделям при раскрытии строки. Функционал 1:1, контур .nd.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import { money } from "../../lib/format";
import NdMenu from "./NdMenu";
import NdSectionTabs, { REPORTS_TABS } from "./NdSectionTabs";
import NdSortReset from "./NdSortReset";
import NdDataTable from "./NdDataTable";
import type { Column } from "./NdDataTable";
import { shortDate as sd, NdSearch } from "./shared";
import "./newdash.css";

type CarrierWeek = { week_start: string; week_end: string; trips: number; gross: number; fines: number; net: number };
type CarrierRow = {
  carrier_name: string;
  carrier_id: number | null;
  counterparty_id: number | null;
  counterparty_name: string | null;
  trips: number; gross: number; fines: number; net: number; paid: number; balance: number;
  weeks: CarrierWeek[];
};

export default function NewDashCarriers() {
  const [all, setAll] = useState<CarrierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dense, setDense] = useState(true);
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    api.get<CarrierRow[]>("/api/carriers/balance/")
      .then(d => { if (!cancelled) setAll(d.map(r => ({   // копейки округляем везде
        ...r,
        gross: Math.round(r.gross), fines: Math.round(r.fines), net: Math.round(r.net),
        paid: Math.round(r.paid), balance: Math.round(r.balance),
        weeks: r.weeks.map(w => ({ ...w, gross: Math.round(w.gross), fines: Math.round(w.fines), net: Math.round(w.net) })),
      }))); })
      .catch(err => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Ошибка загрузки"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter(r => !s || `${r.carrier_name} ${r.counterparty_name || ""}`.toLowerCase().includes(s));
  }, [all, q]);

  const t = useMemo(() => rows.reduce((a, r) => ({
    trips: a.trips + r.trips, gross: a.gross + r.gross, fines: a.fines + r.fines,
    net: a.net + r.net, paid: a.paid + r.paid, balance: a.balance + r.balance,
  }), { trips: 0, gross: 0, fines: 0, net: 0, paid: 0, balance: 0 }), [rows]);

  const columns: Column<CarrierRow>[] = [
    { key: "carrier_name", label: "Перевозчик", type: "text", width: "minmax(180px, 1fr)", sticky: true, strong: true, sortValue: r => r.carrier_name,
      render: r => (
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
          <span style={{ fontWeight: 600 }}>{r.carrier_name}</span>
          {r.counterparty_name && <span className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>({r.counterparty_name})</span>}
        </span>
      ) },
    { key: "trips", label: "Рейсов", type: "num", width: "80px", total: "sum" },
    { key: "gross", label: "Брутто", type: "money", width: "110px", total: "sum" },
    { key: "fines", label: "Штрафы", type: "money", width: "98px", total: "sum", cellTone: r => (r.fines ? "neg" : undefined) },
    { key: "net", label: "Netto (после СК)", type: "money", width: "124px", total: "sum" },
    { key: "paid", label: "Оплачено", type: "money", width: "106px", total: "sum", cellTone: r => (r.paid > 0 ? "pos" : undefined),
      format: v => ((v as number) > 0 ? money(v as number) : "—") },
    { key: "balance", label: "Баланс", type: "money", width: "110px", strong: true, total: "sum",
      cellTone: r => (r.balance > 0 ? "neg" : r.balance < 0 ? "pos" : undefined) },
  ];

  return (
    <div className="nd">
      <NdMenu active="reports" />
      <main className="main" data-pad="wide">
        <header className="topbar">
          <div className="topbar__title">
            <h1 className="t-h1" style={{ margin: 0 }}>Перевозчики</h1>
            <span className="t-mono muted">баланс · {all.length}</span>
          </div>
          <div className="spacer" />
          <NdSearch value={q} onChange={setQ} placeholder="Перевозчик, контрагент…" />
        </header>

        <NdSectionTabs tabs={REPORTS_TABS} right={
          <button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Обычно" : "Компактно"}</button>
        } />

        <div className="summarystrip">
          <div className="summary"><div className="summary__label">Перевозчиков</div><div className="summary__value">{loading ? "…" : rows.length}</div></div>
          <div className="summary"><div className="summary__label">Рейсов</div><div className="summary__value">{loading ? "…" : t.trips}</div></div>
          <div className="summary"><div className="summary__label">Брутто</div><div className="summary__value">{loading ? "…" : money(t.gross)}</div></div>
          <div className="summary"><div className="summary__label">Netto (после СК)</div><div className="summary__value">{loading ? "…" : money(t.net)}</div></div>
          <div className="summary"><div className="summary__label">Оплачено</div><div className="summary__value">{loading ? "…" : money(t.paid)}</div></div>
          <div className="summary"><div className="summary__label">Баланс</div><div className={"summary__value" + (t.balance > 0 ? " neg" : "")}>{loading ? "…" : money(t.balance)}</div></div>
        </div>

        <div className="filterbar">
          <span className="t-body-s muted">Клик по строке — детализация по неделям. Красный баланс — нам должны, зелёный — переплата.</span>
          <div className="spacer" />
          <NdSortReset active={sorted} onReset={() => resetSortRef.current()} />
        </div>

        <div className="rpt-table" style={{ flex: 1, minHeight: 0, padding: "12px 32px 20px", display: "flex", flexDirection: "column" }}>
          <NdDataTable<CarrierRow>
            columns={columns} rows={rows} loading={loading} dense={dense} totals
            onSortActive={setSorted} resetRef={resetSortRef}
            sortKey="balance" sortDir={-1} rowId={r => r.carrier_id ?? r.carrier_name}
            empty={error ? "Не удалось загрузить" : "Рейсов с перевозчиком нет"}
            emptyHint={error ? "Проверьте доступ и повторите" : "Укажите перевозчика в рейсах"}
            expand={r => (
              <div style={{ padding: "0 0 4px 40px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(160px,auto) repeat(4, minmax(84px,auto))", gap: "6px 24px", fontSize: 12.5, width: "fit-content" }}>
                  <div className="muted" style={{ fontWeight: 600 }}>Неделя</div>
                  <div className="muted" style={{ fontWeight: 600, textAlign: "right" }}>Рейсов</div>
                  <div className="muted" style={{ fontWeight: 600, textAlign: "right" }}>Брутто</div>
                  <div className="muted" style={{ fontWeight: 600, textAlign: "right" }}>Штрафы</div>
                  <div className="muted" style={{ fontWeight: 600, textAlign: "right" }}>Netto (после СК)</div>
                  {r.weeks.map(w => (
                    <Fragment key={w.week_start}>
                      <div style={{ whiteSpace: "nowrap" }}>{sd(w.week_start)} – {sd(w.week_end)}</div>
                      <div style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{w.trips}</div>
                      <div style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{money(w.gross)}</div>
                      <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", color: w.fines ? "var(--danger)" : undefined }}>{w.fines ? money(w.fines) : "—"}</div>
                      <div style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{money(w.net)}</div>
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          />
        </div>
      </main>
    </div>
  );
}
