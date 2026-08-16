/**
 * NewDashMileage — вкладка «Пробеги» (/newdash/trips/mileage).
 * Журнал пробегов на шаблоне NdDataTable. Данные /api/mileage-logs/
 * (+ trucks/drivers для подписей).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import { fmtDate, isoDate, uniqueSorted } from "../../lib/format";
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
import { NdSearch, useIsPhone } from "./shared";
import "./newdash.css";

type MileageEntry = { id: number; date: string; truck_id: number; driver_id: number | null; odometer: number | null; is_service: boolean; note: string };
type Truck = { id: number; label: string; plate?: string };
type Driver = { id: number; name: string };
type Row = MileageEntry & { truck: string; driver: string; service: string };

const COLUMNS: Column<Row>[] = [
  { key: "date", label: "Дата", type: "date", width: "120px", sticky: true, strong: true, format: v => fmtDate(v as string) },
  { key: "truck", label: "Машина", type: "id", width: "130px" },
  { key: "driver", label: "Водитель", type: "text", width: "minmax(160px, 1fr)" },
  { key: "odometer", label: "Одометр, км", type: "num", width: "140px" },
  { key: "service", label: "ТО", type: "status", width: "130px", tone: r => (r.is_service ? "ok" : "idle") },
  { key: "note", label: "Примечание", type: "text", width: "220px" },
];

export default function NewDashMileage() {
  const [entries, setEntries] = useState<MileageEntry[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dense, setDense] = useState(true);
  const [truckF, setTruckF] = useState<Set<string>>(new Set());
  const [driverF, setDriverF] = useState<Set<string>>(new Set());
  const [onlyService, setOnlyService] = useState(false);
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});
  const [dateFrom, setDateFrom] = useState(() => isoDate(new Date(Date.now() - 60 * 864e5)));
  const [dateTo, setDateTo] = useState(() => isoDate(new Date()));
  const isPhone = useIsPhone();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeCount = (truckF.size ? 1 : 0) + (driverF.size ? 1 : 0) + (onlyService ? 1 : 0) + (sorted ? 1 : 0);
  const resetAllFilters = () => {
    setTruckF(new Set()); setDriverF(new Set()); setOnlyService(false);
    setDateFrom(isoDate(new Date(Date.now() - 60 * 864e5))); setDateTo(isoDate(new Date()));
    resetSortRef.current();
  };

  // Внесение пробега
  const [addOpen, setAddOpen] = useState(false);
  const [fDate, setFDate] = useState(() => isoDate(new Date()));
  const [fTruck, setFTruck] = useState<number | "">("");
  const [fDriver, setFDriver] = useState<number | "">("");
  const [fOdo, setFOdo] = useState("");
  const [fService, setFService] = useState(false);
  const [fNote, setFNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      api.get<MileageEntry[]>("/api/mileage-logs/"),
      api.get<Truck[]>("/api/trucks/"),
      api.get<Driver[]>("/api/drivers/"),
    ])
      .then(([m, tr, d]) => { if (alive) { setEntries(m); setTrucks(tr); setDrivers(d); setError(null); } })
      .catch(err => { if (alive) setError(err instanceof ApiError ? err.message : "Ошибка загрузки"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const truckLabel = (id: number) => trucks.find(t => t.id === id)?.plate || trucks.find(t => t.id === id)?.label || `#${id}`;
  const driverName = (id: number | null) => (id == null ? "—" : drivers.find(d => d.id === id)?.name || `#${id}`);

  const enriched: Row[] = useMemo(
    () => entries.map(e => ({ ...e, truck: truckLabel(e.truck_id), driver: driverName(e.driver_id), service: e.is_service ? "ТО / сервис" : "обычный" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, trucks, drivers]);

  const truckOptions = useMemo(() => uniqueSorted(enriched.map(r => r.truck)), [enriched]);
  const driverOptions = useMemo(() => uniqueSorted(enriched.map(r => r.driver)), [enriched]);

  const rows: Row[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    return enriched.filter(r => {
      const day = (r.date || "").slice(0, 10);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (truckF.size && !truckF.has(r.truck)) return false;
      if (driverF.size && !driverF.has(r.driver)) return false;
      if (onlyService && !r.is_service) return false;
      if (s && !`${r.truck} ${r.driver} ${r.note} ${r.odometer ?? ""}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [enriched, q, truckF, driverF, onlyService, dateFrom, dateTo]);

  async function reload() {
    const [m, tr, d] = await Promise.all([
      api.get<MileageEntry[]>("/api/mileage-logs/"), api.get<Truck[]>("/api/trucks/"), api.get<Driver[]>("/api/drivers/"),
    ]);
    setEntries(m); setTrucks(tr); setDrivers(d);
  }
  function openAdd() {
    setFDate(isoDate(new Date())); setFTruck(""); setFDriver(""); setFOdo(""); setFService(false); setFNote("");
    setAddOpen(true);
  }
  async function handleAdd() {
    if (!fTruck || !fOdo) return;
    setSaving(true); setError(null);
    try {
      await api.post("/api/mileage-logs/", {
        date: fDate, truck_id: fTruck, driver_id: fDriver || null,
        odometer: Number(fOdo), is_service: fService, note: fNote,
      });
      setAddOpen(false);
      await reload();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  }

  return (
    <div className="nd">
      <NdMenu active="trips" />
      <main className="main">
        {isPhone ? (
          <>
            <NdPhoneHead title="Пробеги" subtitle={`журнал · ${entries.length}`} onAdd={openAdd} />
            <NdSectionTabs tabs={TRIPS_TABS} />
            <div className="nd-searchrow">
              <NdSearch value={q} onChange={setQ} placeholder="Машина, водитель, примечание…" />
              <NdFilterButton count={activeCount} onClick={() => setFiltersOpen(true)} />
            </div>
          </>
        ) : (
          <>
            <header className="topbar">
              <div className="topbar__title">
                <h1 className="t-h1" style={{ margin: 0 }}>Пробеги</h1>
                <span className="t-mono muted">журнал · {entries.length}</span>
              </div>
              <div className="spacer" />
              <NdSearch value={q} onChange={setQ} placeholder="Машина, водитель, примечание…" />
            </header>
            <NdSectionTabs tabs={TRIPS_TABS} right={<>
              <button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Обычно" : "Компактно"}</button>
              <button className="btn btn--accent" onClick={openAdd}>Внести пробег</button>
            </>} />
          </>
        )}

        <NdFilters open={filtersOpen} onClose={() => setFiltersOpen(false)} onReset={resetAllFilters} section="Пробеги">
          <NdDateRange from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
          <NdMultiSelect label="Машина" options={truckOptions} selected={truckF} onChange={setTruckF} />
          <NdMultiSelect label="Водитель" options={driverOptions} selected={driverF} onChange={setDriverF} />
          <button type="button" className="switch" aria-pressed={onlyService} onClick={() => setOnlyService(v => !v)}>
            <span className="switch__track"><span className="switch__knob" /></span>
            Только ТО
          </button>
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
              title: <>{fmtDate(r.date as string)}{r.is_service ? <span className="status status--ok" style={{ marginLeft: 6 }}>ТО</span> : null}</>,
              subtitle: r.truck,
              right: <div style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{r.odometer != null ? `${(r.odometer as number).toLocaleString("ru-RU")} км` : "—"}</div>,
              collapsible: true,
              facts: [
                { label: "Водитель", value: r.driver || "—" },
                { label: "Примечание", value: r.note || "—" },
              ],
            })}
            onSortActive={setSorted}
            resetRef={resetSortRef}
            sortKey="date"
            sortDir={-1}
            rowId={r => r.id}
            empty={error ? "Не удалось загрузить пробеги" : "Записей о пробеге нет"}
            emptyHint={error ? "Проверьте доступ и повторите" : "Пробеги вносятся водителями и бригадиром"}
          />
        </div>
      </main>

      {/* Модалка внесения пробега */}
      {addOpen && (
        <NdModal
          size="form"
          title="Внести пробег"
          subtitle="Одометр на дату. Отметьте «ТО», если это сервисная запись."
          onClose={() => setAddOpen(false)}
          actions={[
            { label: "Отмена", kind: "ghost", onClick: () => setAddOpen(false) },
            { label: saving ? "Сохранение…" : "Сохранить", kind: "accent", grow: true, disabled: !fTruck || !fOdo || saving, onClick: handleAdd },
          ]}
        >
          <div className="field">
            <span className="field__label">Дата</span>
            <input type="date" className="field__input" value={fDate} onChange={e => setFDate(e.target.value)} />
          </div>
          <div className="field">
            <span className="field__label">Машина</span>
            <select className="field__input" value={fTruck} onChange={e => setFTruck(e.target.value ? Number(e.target.value) : "")}>
              <option value="">— выберите —</option>
              {trucks.map(t => <option key={t.id} value={t.id}>{t.plate || t.label}</option>)}
            </select>
          </div>
          <div className="field">
            <span className="field__label">Водитель (необязательно)</span>
            <select className="field__input" value={fDriver} onChange={e => setFDriver(e.target.value ? Number(e.target.value) : "")}>
              <option value="">— не указан —</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="field">
            <span className="field__label">Одометр, км</span>
            <input type="number" className="field__input" value={fOdo} onChange={e => setFOdo(e.target.value)} placeholder="напр. 154000" />
          </div>
          <button type="button" className="switch" aria-pressed={fService} onClick={() => setFService(v => !v)} style={{ alignSelf: "flex-start" }}>
            <span className="switch__track"><span className="switch__knob" /></span>
            Сервисная запись (ТО)
          </button>
          <div className="field">
            <span className="field__label">Примечание</span>
            <input type="text" className="field__input" value={fNote} onChange={e => setFNote(e.target.value)} placeholder="комментарий" />
          </div>
          {error && <div className="field__error">{error}</div>}
        </NdModal>
      )}
    </div>
  );
}
