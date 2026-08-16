/**
 * NewDashTrips — вкладка «Рейсы» интерфейса логиста (/newdash/trips).
 * Реестр рейсов на шаблоне NdDataTable. Фильтры (даты + мультивыбор
 * статус/водитель/машина/перевозчик + строк на странице), виджеты-сводки
 * (поездок / сумма / биллинг / штрафы), мультивыбор строк, таблица во всю ширину.
 * Данные: /api/trips/ (+ drivers/trucks/carriers для фильтров и биллинга).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import { isoDate, money, uniqueSorted } from "../../lib/format";
import NdMenu from "./NdMenu";
import NdSectionTabs, { TRIPS_TABS } from "./NdSectionTabs";
import NdMultiSelect from "./NdMultiSelect";
import NdDateRange from "./NdDateRange";
import NdSortReset from "./NdSortReset";
import NdFilters, { NdFilterButton } from "./NdFilters";
import NdPhoneHead from "./NdPhoneHead";
import NdModal from "./NdModal";
import NdDataTable from "./NdDataTable";
import type { Column } from "./NdDataTable";
import { fmtDateTime, NdSearch, useIsPhone } from "./shared";
import "./newdash.css";

type Trip = {
  id: number;
  request_number: string;
  external_request_number: string;
  tariff_type: string;
  plate_raw: string;
  truck_id: number | null;
  driver_name_raw: string;
  driver_id: number | null;
  driver_phone: string;
  confirmed_at: string | null;
  status: string;
  dep_at: string;
  end_at: string | null;
  amount: number;
  fines: number;
  source: string;
  carrier_name: string;
};
type Driver = { id: number; name: string };
type Truck = { id: number; label: string; plate?: string };
type Carrier = { id: number; name: string; insurance_pct: number };
type ImportSummary = { total_rows: number; trips_created: number; trips_updated: number; skipped_bad_rows: number; new_drivers: string[]; new_trucks: string[] };

const SOURCES = ["OZON", "WB", "ATI", "Прямые", "Прочие"];

// Обогащённая строка для таблицы (готовые driver/truck/billing поля)
type Row = Trip & { driver: string; truck: string; billing: number };

function statusTone(s: string): string {
  const l = (s || "").toLowerCase();
  if (l.startsWith("отмен")) return "risk";
  if (l.includes("заверш") || l.includes("выполн") || l.includes("достав") || l.includes("законч")) return "ok";
  if (l.includes("пути") || l.includes("погруз") || l.includes("выгруз")) return "warn";
  return "idle";
}

const COLUMNS: Column<Row>[] = [
  { key: "source", label: "Источник", type: "id", width: "88px", sticky: true },
  { key: "carrier_name", label: "Перевозчик", type: "text", width: "minmax(160px, 1fr)" },
  { key: "request_number", label: "№ заявки", type: "id", width: "112px", strong: true },
  { key: "status", label: "Статус", type: "status", width: "134px", tone: r => statusTone(r.status) },
  { key: "dep_at", label: "Отгрузка", type: "date", width: "150px", format: v => fmtDateTime(v) },
  { key: "end_at", label: "Окончание", type: "date", width: "150px", format: v => fmtDateTime(v) },
  { key: "tariff_type", label: "Тип", type: "text", width: "110px" },
  { key: "driver", label: "Водитель", type: "text", width: "154px" },
  { key: "truck", label: "Машина", type: "id", width: "116px" },
  { key: "driver_phone", label: "Телефон", type: "id", width: "132px" },
  { key: "amount", label: "Сумма", type: "money", width: "126px" },
  { key: "fines", label: "Штраф", type: "money", width: "104px", cellTone: r => (r.fines > 0 ? "neg" : "mute") },
];

export default function NewDashTrips() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [dense, setDense] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => isoDate(new Date(Date.now() - 60 * 864e5)));
  const [dateTo, setDateTo] = useState(() => isoDate(new Date()));
  const [statusF, setStatusF] = useState<Set<string>>(new Set());
  const [driverF, setDriverF] = useState<Set<string>>(new Set());
  const [truckF, setTruckF] = useState<Set<string>>(new Set());
  const [carrierF, setCarrierF] = useState<Set<string>>(new Set());
  const [onlyFines, setOnlyFines] = useState(false);
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});
  const isPhone = useIsPhone();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeCount = (statusF.size ? 1 : 0) + (driverF.size ? 1 : 0) + (truckF.size ? 1 : 0) + (carrierF.size ? 1 : 0) + (onlyFines ? 1 : 0) + (sorted ? 1 : 0);
  const resetAllFilters = () => {
    setStatusF(new Set()); setDriverF(new Set()); setTruckF(new Set()); setCarrierF(new Set()); setOnlyFines(false);
    setDateFrom(isoDate(new Date(Date.now() - 60 * 864e5))); setDateTo(isoDate(new Date()));
    resetSortRef.current();
  };

  // импорт/экспорт/шаблон
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSource, setImportSource] = useState(SOURCES[0]);
  const [importCarrier, setImportCarrier] = useState("");
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      api.get<Trip[]>("/api/trips/"),
      api.get<Driver[]>("/api/drivers/"),
      api.get<Truck[]>("/api/trucks/"),
      api.get<Carrier[]>("/api/carriers/"),
    ])
      .then(([t, d, tr, c]) => { if (alive) { setTrips(t); setDrivers(d); setTrucks(tr); setCarriers(c); setError(null); } })
      .catch(err => { if (alive) setError(err instanceof ApiError ? err.message : "Ошибка загрузки"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const driverName = (t: Trip) => drivers.find(d => d.id === t.driver_id)?.name || t.driver_name_raw || "—";
  const truckLabel = (t: Trip) => trucks.find(tr => tr.id === t.truck_id)?.plate || t.plate_raw || "—";
  const billingFor = (t: Trip) => t.amount * (1 - (carriers.find(c => c.name === t.carrier_name)?.insurance_pct || 0) / 100);

  // опции фильтров
  const statusOptions = useMemo(() => uniqueSorted(trips.map(t => t.status || "—")), [trips]);
  const driverOptions = useMemo(() => uniqueSorted(trips.map(driverName)), [trips, drivers]);
  const truckOptions = useMemo(() => uniqueSorted(trips.map(truckLabel)), [trips, trucks]);
  const carrierOptions = useMemo(() => uniqueSorted(trips.map(t => t.carrier_name || "—")), [trips]);

  // фильтрация + обогащение
  const rows: Row[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    return trips
      .filter(t => {
        const day = (t.dep_at || "").slice(0, 10);
        if (dateFrom && day < dateFrom) return false;
        if (dateTo && day > dateTo) return false;
        if (statusF.size && !statusF.has(t.status || "—")) return false;
        if (driverF.size && !driverF.has(driverName(t))) return false;
        if (truckF.size && !truckF.has(truckLabel(t))) return false;
        if (carrierF.size && !carrierF.has(t.carrier_name || "—")) return false;
        if (onlyFines && !(t.fines > 0)) return false;
        if (s && !`${t.request_number} ${t.external_request_number} ${driverName(t)} ${truckLabel(t)} ${t.carrier_name} ${t.source} ${t.status}`.toLowerCase().includes(s)) return false;
        return true;
      })
      .map(t => ({ ...t, driver: driverName(t), truck: truckLabel(t), billing: billingFor(t) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips, drivers, trucks, carriers, q, dateFrom, dateTo, statusF, driverF, truckF, carrierF, onlyFines]);

  // сводки по выборке
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const totalBilling = rows.reduce((s, r) => s + r.billing, 0);
  const totalFines = rows.reduce((s, r) => s + (r.fines || 0), 0);

  // перевозчик по умолчанию для импорта
  useEffect(() => { if (carriers.length && !importCarrier) setImportCarrier(carriers[0].name); }, [carriers, importCarrier]);

  async function reloadAll() {
    const [t, d, tr, c] = await Promise.all([
      api.get<Trip[]>("/api/trips/"), api.get<Driver[]>("/api/drivers/"),
      api.get<Truck[]>("/api/trucks/"), api.get<Carrier[]>("/api/carriers/"),
    ]);
    setTrips(t); setDrivers(d); setTrucks(tr); setCarriers(c);
  }

  async function handleTemplate() {
    setBusy("template"); setError(null);
    try { await api.download("/api/trips/import/template", "shablon_reestr_poezdok.xlsx"); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка скачивания шаблона"); }
    finally { setBusy(null); }
  }

  async function handleExport() {
    setBusy("export"); setError(null);
    try {
      const payload = rows.map(r => ({
        source: r.source, carrier_name: r.carrier_name || "—", request_number: r.request_number,
        status: r.status || "—", dep_at: fmtDateTime(r.dep_at), end_at: fmtDateTime(r.end_at),
        tariff_type: r.tariff_type || "—", driver_name: r.driver, truck_label: r.truck,
        driver_phone: r.driver_phone || "—", amount: r.amount, billing: r.billing, fines: r.fines || 0,
      }));
      await api.downloadPost("/api/trips/export", { rows: payload }, "reestr_poezdok.xlsx");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка экспорта"); }
    finally { setBusy(null); }
  }

  function openImport() {
    setImportSummary(null); setImportFile(null); setImportSource(SOURCES[0]);
    setImportCarrier(c => c || carriers[0]?.name || "");
    setImportOpen(true);
  }

  async function handleImportSubmit() {
    if (!importFile) return;
    setImporting(true); setError(null); setImportSummary(null);
    try {
      const res = await api.upload<ImportSummary>("/api/trips/import", importFile, { source: importSource, carrier_name: importCarrier });
      setImportSummary(res);
      setImportFile(null);
      await reloadAll();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка импорта"); }
    finally { setImporting(false); }
  }

  return (
    <div className="nd">
      <NdMenu active="trips" />

      <main className="main">
        {/* Шапка */}
        {isPhone ? (
          <NdPhoneHead
            title="Рейсы"
            subtitle={`реестр · ${trips.length}`}
            onAdd={openImport}
            menu={<>
              <NdSectionTabs tabs={TRIPS_TABS} />
              <button className="btn btn--ghost" disabled={busy === "template"} onClick={handleTemplate}>Скачать шаблон .xlsx</button>
              <button className="btn btn--ghost" disabled={busy === "export"} onClick={handleExport}>Экспорт в .xlsx</button>
              <button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Компактный вид" : "Обычный вид"}</button>
            </>}
          />
        ) : (
          <>
            <header className="topbar">
              <div className="topbar__title">
                <h1 className="t-h1" style={{ margin: 0 }}>Рейсы</h1>
                <span className="t-mono muted">реестр · {trips.length}</span>
              </div>
              <div className="spacer" />
              <NdSearch value={q} onChange={setQ} placeholder="Заявка, водитель, машина…" />
            </header>

            <NdSectionTabs tabs={TRIPS_TABS} right={<>
              <button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Обычно" : "Компактно"}</button>
              <button type="button" className="icon-btn" title="Скачать шаблон .xlsx" disabled={busy === "template"} onClick={handleTemplate}>
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="1.5" width="9" height="12" rx="1.5" /><path d="M5.2 5h4.6" /><path d="M5.2 7.6h4.6" /><path d="M5.2 10.2h2.8" /></svg>
              </button>
              <button type="button" className="icon-btn" title="Экспорт в .xlsx" disabled={busy === "export"} onClick={handleExport}>
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M7.5 1.5v8" /><path d="M4.2 6.2 7.5 9.5l3.3-3.3" /><path d="M2.4 12.5h10.2" /></svg>
              </button>
              <button type="button" className="btn btn--accent" onClick={openImport}>Импорт реестра</button>
            </>} />
          </>
        )}

        {/* Виджеты-сводки по выборке */}
        <div className="summarystrip">
          <div className="summary"><div className="summary__label">Поездок в выборке</div><div className="summary__value">{loading ? "…" : rows.length}</div></div>
          <div className="summary"><div className="summary__label">Сумма по выборке</div><div className="summary__value">{loading ? "…" : money(totalAmount)}</div></div>
          <div className="summary"><div className="summary__label">Биллинг по выборке</div><div className="summary__value">{loading ? "…" : money(totalBilling)}</div></div>
          <div className="summary"><div className="summary__label">Штрафы по выборке</div><div className="summary__value neg">{loading ? "…" : money(totalFines)}</div></div>
        </div>

        {/* Телефон: строка поиска + воронка фильтров (под виджетами) */}
        {isPhone && (
          <div className="nd-searchrow">
            <NdSearch value={q} onChange={setQ} placeholder="Заявка, водитель, машина…" />
            <NdFilterButton count={activeCount} onClick={() => setFiltersOpen(true)} />
          </div>
        )}

        {/* Фильтры: десктоп — строка, телефон — лист снизу по воронке */}
        <NdFilters open={filtersOpen} onClose={() => setFiltersOpen(false)} onReset={resetAllFilters} section="Рейсы">
          <NdDateRange from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
          <NdMultiSelect label="Статус" options={statusOptions} selected={statusF} onChange={setStatusF} />
          <NdMultiSelect label="Водитель" options={driverOptions} selected={driverF} onChange={setDriverF} />
          <NdMultiSelect label="Машина" options={truckOptions} selected={truckF} onChange={setTruckF} />
          <NdMultiSelect label="Перевозчик" options={carrierOptions} selected={carrierF} onChange={setCarrierF} />
          <button type="button" className="switch" aria-pressed={onlyFines} onClick={() => setOnlyFines(v => !v)}>
            <span className="switch__track"><span className="switch__knob" /></span>
            Штрафы
          </button>
          <NdSortReset active={sorted} onReset={() => resetSortRef.current()} />
        </NdFilters>

        {/* Таблица (телефон — карточки без обёртки) */}
        <div className={isPhone ? "nd-listwrap" : undefined} style={isPhone ? undefined : { flex: 1, minHeight: 0, padding: "12px 24px 20px", display: "flex", flexDirection: "column" }}>
          <NdDataTable<Row>
            columns={COLUMNS}
            rows={rows}
            loading={loading}
            dense={dense}
            select
            onSortActive={setSorted}
            resetRef={resetSortRef}
            sortKey="dep_at"
            sortDir={-1}
            rowId={r => r.id}
            empty={error ? "Не удалось загрузить рейсы" : "Рейсов по заданным условиям нет"}
            emptyHint={error ? "Проверьте доступ и повторите" : "Смягчите фильтры или расширьте период"}
            bulkSummary={ids => `сумма ${money(ids.reduce<number>((a, id) => a + (rows.find(r => r.id === id)?.amount || 0), 0))}`}
            bulkActions={[
              {
                label: "Экспорт выбранных",
                onClick: async ids => {
                  const sel = rows.filter(r => ids.includes(r.id));
                  const payload = sel.map(r => ({
                    source: r.source, carrier_name: r.carrier_name || "—", request_number: r.request_number,
                    status: r.status || "—", dep_at: fmtDateTime(r.dep_at), end_at: fmtDateTime(r.end_at),
                    tariff_type: r.tariff_type || "—", driver_name: r.driver, truck_label: r.truck,
                    driver_phone: r.driver_phone || "—", amount: r.amount, billing: r.billing, fines: r.fines || 0,
                  }));
                  try { await api.downloadPost("/api/trips/export", { rows: payload }, "reestr_poezdok.xlsx"); }
                  catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка экспорта"); }
                },
              },
              {
                label: "Удалить",
                onClick: async (ids, tapi) => {
                  if (!window.confirm(`Удалить ${ids.length} рейс(ов)? Действие необратимо.`)) return;
                  try { await api.post("/api/trips/bulk-delete", { ids }); tapi.clearSelection(); await reloadAll(); }
                  catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка удаления"); }
                },
              },
            ]}
            expand={r => (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px 24px" }}>
                <div><div className="t-mono-label">Внешний №</div><div className="t-body" style={{ marginTop: 5, fontWeight: 500, fontFamily: "var(--font-mono)" }}>{r.external_request_number || "—"}</div></div>
                <div><div className="t-mono-label">Биллинг</div><div className="t-body num" style={{ marginTop: 5, fontWeight: 500, fontFamily: "var(--font-mono)" }}>{money(r.billing)}</div></div>
                <div><div className="t-mono-label">Подтверждён</div><div className="t-body" style={{ marginTop: 5, fontWeight: 500 }}>{fmtDateTime(r.confirmed_at)}</div></div>
                <div><div className="t-mono-label">Телефон</div><div className="t-body" style={{ marginTop: 5, fontWeight: 500, fontFamily: "var(--font-mono)" }}>{r.driver_phone || "—"}</div></div>
              </div>
            )}
          />
        </div>
      </main>

      {/* Модалка импорта */}
      {importOpen && (
        <NdModal
          size="form"
          title="Импорт реестра рейсов"
          subtitle="Файл .xlsx по шаблону. Источник и перевозчик проставятся всем строкам."
          onClose={() => setImportOpen(false)}
          actions={importSummary
            ? [{ label: "Готово", kind: "primary", grow: true, onClick: () => setImportOpen(false) }]
            : [
                { label: "Отмена", kind: "ghost", onClick: () => setImportOpen(false) },
                { label: importing ? "Импорт…" : "Импортировать", kind: "accent", grow: true, disabled: !importFile || !importCarrier || importing, onClick: handleImportSubmit },
              ]}
        >
          {importSummary ? (
            <div className="facts">
              <div className="facts__row"><span className="facts__label">Всего строк</span><span className="facts__value">{importSummary.total_rows}</span></div>
              <div className="facts__row"><span className="facts__label">Создано рейсов</span><span className="facts__value">{importSummary.trips_created}</span></div>
              <div className="facts__row"><span className="facts__label">Обновлено</span><span className="facts__value">{importSummary.trips_updated}</span></div>
              <div className="facts__row"><span className="facts__label">Пропущено (ошибки)</span><span className="facts__value">{importSummary.skipped_bad_rows}</span></div>
              {importSummary.new_drivers.length > 0 && <div className="facts__row"><span className="facts__label">Новые водители</span><span className="facts__value">{importSummary.new_drivers.length}</span></div>}
              {importSummary.new_trucks.length > 0 && <div className="facts__row"><span className="facts__label">Новые машины</span><span className="facts__value">{importSummary.new_trucks.length}</span></div>}
            </div>
          ) : (
            <>
              <div className="field">
                <span className="field__label">Источник заявок</span>
                <select className="field__input" value={importSource} onChange={e => setImportSource(e.target.value)}>
                  {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <span className="field__label">Перевозчик</span>
                <select className="field__input" value={importCarrier} onChange={e => setImportCarrier(e.target.value)}>
                  {carriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="field">
                <span className="field__label">Файл реестра</span>
                <input type="file" accept=".xlsx" onChange={e => setImportFile(e.target.files?.[0] || null)}
                  style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink)" }} />
              </div>
              {error && <div className="field__error">{error}</div>}
            </>
          )}
        </NdModal>
      )}
    </div>
  );
}
