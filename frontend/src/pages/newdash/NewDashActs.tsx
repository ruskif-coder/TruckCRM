/**
 * NewDashActs — вкладка «Акты ПП ТС» (приёмо-передача авто) (/newdash/trips/acts).
 * Журнал сессий приёмки-сдачи на шаблоне NdDataTable.
 * Данные /api/vehicle-inspections/sessions/.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import { isoDate, uniqueSorted } from "../../lib/format";
import NdMenu from "./NdMenu";
import NdSectionTabs, { TRIPS_TABS } from "./NdSectionTabs";
import NdMultiSelect from "./NdMultiSelect";
import NdDateRange from "./NdDateRange";
import NdSortReset from "./NdSortReset";
import NdFilters, { NdFilterButton } from "./NdFilters";
import NdPhoneHead from "./NdPhoneHead";
import NdModal from "./NdModal";
import ActDetailModal from "./ActDetailModal";
import NdDataTable from "./NdDataTable";
import type { Column } from "./NdDataTable";
import { fmtDateTime, NdSearch, useIsPhone } from "./shared";
import "./newdash.css";

type Session = {
  id: number;
  driver_id: number; driver_name: string;
  truck_id: number; truck_plate: string; truck_label: string;
  started_at: string; ended_at: string | null;
  start_inspection_id: number | null;
};
type Row = Session & { status: string; state: "done" | "active" };

const COLUMNS: Column<Row>[] = [
  { key: "started_at", label: "Начата", type: "date", width: "150px", sticky: true, strong: true, format: v => fmtDateTime(v) },
  { key: "ended_at", label: "Завершена", type: "date", width: "150px", format: v => fmtDateTime(v) },
  { key: "truck_plate", label: "Машина", type: "id", width: "120px" },
  { key: "driver_name", label: "Водитель", type: "text", width: "minmax(160px, 1fr)" },
  { key: "status", label: "Статус", type: "status", width: "150px", tone: r => (r.state === "active" ? "warn" : "ok") },
];

export default function NewDashActs() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dense, setDense] = useState(true);
  const [truckF, setTruckF] = useState<Set<string>>(new Set());
  const [driverF, setDriverF] = useState<Set<string>>(new Set());
  const [statusF, setStatusF] = useState<Set<string>>(new Set());
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});
  const [dateFrom, setDateFrom] = useState(() => isoDate(new Date(Date.now() - 60 * 864e5)));
  const [dateTo, setDateTo] = useState(() => isoDate(new Date()));
  const isPhone = useIsPhone();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeCount = (truckF.size ? 1 : 0) + (driverF.size ? 1 : 0) + (statusF.size ? 1 : 0) + (sorted ? 1 : 0);
  const resetAllFilters = () => {
    setTruckF(new Set()); setDriverF(new Set()); setStatusF(new Set());
    setDateFrom(isoDate(new Date(Date.now() - 60 * 864e5))); setDateTo(isoDate(new Date()));
    resetSortRef.current();
  };

  const [viewId, setViewId] = useState<number | null>(null);   // открытый акт (просмотр)

  // принудительная сдача авто (закрытие активной сессии)
  const [closeId, setCloseId] = useState<number | null>(null);
  const [closeOdo, setCloseOdo] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  function loadSessions() {
    setLoading(true);
    api.get<Session[]>("/api/vehicle-inspections/sessions/")
      .then(s => { setSessions(s); setError(null); })
      .catch(err => setError(err instanceof ApiError ? err.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { loadSessions(); }, []);

  async function handleForceClose() {
    if (!closeId) return;
    setClosing(true); setCloseError(null);
    try {
      await api.post(`/api/vehicle-inspections/sessions/${closeId}/close`, { odometer: closeOdo.trim() ? parseInt(closeOdo, 10) : null });
      setCloseId(null); setCloseOdo("");
      loadSessions();
    } catch (err) { setCloseError(err instanceof ApiError ? err.message : "Ошибка"); }
    finally { setClosing(false); }
  }

  const enriched: Row[] = useMemo(
    () => sessions.map(x => ({ ...x, state: (x.ended_at ? "done" : "active") as "done" | "active", status: x.ended_at ? "Завершена" : "Активна" })),
    [sessions]);

  const truckOptions = useMemo(() => uniqueSorted(enriched.map(r => r.truck_plate || `#${r.truck_id}`)), [enriched]);
  const driverOptions = useMemo(() => uniqueSorted(enriched.map(r => r.driver_name || `#${r.driver_id}`)), [enriched]);
  const statusOptions = ["Активна", "Завершена"];

  const rows: Row[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    return enriched.filter(r => {
      const day = (r.started_at || "").slice(0, 10);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (truckF.size && !truckF.has(r.truck_plate || `#${r.truck_id}`)) return false;
      if (driverF.size && !driverF.has(r.driver_name || `#${r.driver_id}`)) return false;
      if (statusF.size && !statusF.has(r.status)) return false;
      if (s && !`${r.truck_plate} ${r.truck_label} ${r.driver_name} ${r.status}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [enriched, q, truckF, driverF, statusF, dateFrom, dateTo]);

  return (
    <div className="nd">
      <NdMenu active="trips" />
      <main className="main">
        {isPhone ? (
          <>
            <NdPhoneHead title="Приёмка-сдача" subtitle={`сессии · ${sessions.length}`} />
            <NdSectionTabs tabs={TRIPS_TABS} />
            <div className="nd-searchrow">
              <NdSearch value={q} onChange={setQ} placeholder="Машина, водитель, статус…" />
              <NdFilterButton count={activeCount} onClick={() => setFiltersOpen(true)} />
            </div>
          </>
        ) : (
          <>
            <header className="topbar">
              <div className="topbar__title">
                <h1 className="t-h1" style={{ margin: 0 }}>Акты приёмо-передачи</h1>
                <span className="t-mono muted">сессии · {sessions.length}</span>
              </div>
              <div className="spacer" />
              <NdSearch value={q} onChange={setQ} placeholder="Машина, водитель, статус…" />
            </header>
            <NdSectionTabs tabs={TRIPS_TABS} right={
              <button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Обычно" : "Компактно"}</button>
            } />
          </>
        )}

        <NdFilters open={filtersOpen} onClose={() => setFiltersOpen(false)} onReset={resetAllFilters} section="Приёмка-сдача">
          <NdDateRange from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
          <NdMultiSelect label="Машина" options={truckOptions} selected={truckF} onChange={setTruckF} />
          <NdMultiSelect label="Водитель" options={driverOptions} selected={driverF} onChange={setDriverF} />
          <NdMultiSelect label="Статус" options={statusOptions} selected={statusF} onChange={setStatusF} />
          <NdSortReset active={sorted} onReset={() => resetSortRef.current()} />
        </NdFilters>

        <div className={isPhone ? "nd-listwrap" : undefined} style={isPhone ? undefined : { flex: 1, minHeight: 0, padding: "12px 24px 20px", display: "flex", flexDirection: "column" }}>
          <NdDataTable<Row>
            columns={COLUMNS}
            rows={rows}
            loading={loading}
            dense={dense}
            select
            card={r => ({
              title: <>{r.truck_plate || `#${r.truck_id}`}<span className={`status status--${r.state === "active" ? "warn" : "ok"}`} style={{ marginLeft: 6 }}>{r.status}</span></>,
              subtitle: fmtDateTime(r.started_at),
              collapsible: true,
              facts: [
                { label: "Водитель", value: r.driver_name || "—" },
                { label: "Завершена", value: r.ended_at ? fmtDateTime(r.ended_at) : "—" },
              ],
            })}
            onSortActive={setSorted}
            resetRef={resetSortRef}
            sortKey="started_at"
            sortDir={-1}
            rowId={r => r.id}
            empty={error ? "Не удалось загрузить акты" : "Сессий приёмки-сдачи нет"}
            emptyHint={error ? "Проверьте доступ и повторите" : "Акты создаются при приёмке и сдаче авто"}
            onRowClick={r => setViewId(r.id)}
          />
        </div>
      </main>

      {/* Полный акт приёмки-сдачи */}
      {viewId !== null && (
        <ActDetailModal
          sessionId={viewId}
          onClose={() => setViewId(null)}
          onForceClose={id => { setViewId(null); setCloseError(null); setCloseOdo(""); setCloseId(id); }}
        />
      )}

      {/* Модалка принудительной сдачи */}
      {closeId !== null && (
        <NdModal
          size="form"
          title="Принудительная сдача авто"
          subtitle="Сессия будет закрыта без полного акта сдачи. Укажите одометр (необязательно)."
          onClose={() => setCloseId(null)}
          actions={[
            { label: "Отмена", kind: "ghost", onClick: () => setCloseId(null) },
            { label: closing ? "Закрытие…" : "Сдать принудительно", kind: "accent", grow: true, disabled: closing, onClick: handleForceClose },
          ]}
        >
          <div className="field">
            <span className="field__label">Одометр, км</span>
            <input type="number" className="field__input" value={closeOdo} onChange={e => setCloseOdo(e.target.value)} placeholder="напр. 154000" />
          </div>
          {closeError && <div className="field__error">{closeError}</div>}
        </NdModal>
      )}
    </div>
  );
}
