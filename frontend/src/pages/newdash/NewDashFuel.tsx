/**
 * NewDashFuel — раздел «Финансы» → «Топливо» (/newdash/finance/fuel).
 * Реестр заправок на шаблоне NdDataTable. Импорт E100, «провести в расходы»,
 * ручной ввод. Данные: /api/fuel/ (+ trucks).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import { fmtDate, isoDate, money, uniqueSorted } from "../../lib/format";
import NdMenu from "./NdMenu";
import NdSectionTabs, { FINANCE_TABS } from "./NdSectionTabs";
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

type Fuel = { id: number; external_id: string; date: string; station: string; card_number: string; truck_brand_raw: string; plate_raw: string; truck_id: number | null; volume: number; amount: number; external_transaction_id: string };
type Truck = { id: number; label: string; plate?: string };
type Row = Fuel & { truck: string; stationLabel: string };
type ImportSummary = { total_rows: number; records_created: number; records_updated: number; skipped_bad_rows: number; new_trucks: string[] };
type PostSummary = { weeks: number; created: number };

export default function NewDashFuel() {
  const [records, setRecords] = useState<Fuel[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dense, setDense] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => isoDate(new Date(Date.now() - 60 * 864e5)));
  const [dateTo, setDateTo] = useState(() => isoDate(new Date()));
  const [stationF, setStationF] = useState<Set<string>>(new Set());
  const [truckF, setTruckF] = useState<Set<string>>(new Set());
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});
  const isPhone = useIsPhone();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeCount = (stationF.size ? 1 : 0) + (truckF.size ? 1 : 0) + (sorted ? 1 : 0);
  const resetAllFilters = () => {
    setStationF(new Set()); setTruckF(new Set());
    setDateFrom(isoDate(new Date(Date.now() - 60 * 864e5))); setDateTo(isoDate(new Date()));
    resetSortRef.current();
  };

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [postSummary, setPostSummary] = useState<PostSummary | null>(null);
  const [posting, setPosting] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [aDate, setADate] = useState(() => isoDate(new Date()));
  const [aTruck, setATruck] = useState<number | "">("");
  const [aStation, setAStation] = useState("");
  const [aVolume, setAVolume] = useState("");
  const [aAmount, setAAmount] = useState("");
  const [saving, setSaving] = useState(false);

  function loadAll() {
    setLoading(true);
    api.get<Fuel[]>("/api/fuel/").then(f => { setRecords(f); setError(null); }).catch(e => setError(e instanceof ApiError ? e.message : "Ошибка загрузки")).finally(() => setLoading(false));
    api.get<Truck[]>("/api/trucks/").then(setTrucks).catch(() => {});
  }
  useEffect(() => { loadAll(); }, []);

  const truckLabel = (r: Fuel) => trucks.find(t => t.id === r.truck_id)?.plate || r.plate_raw || "—";
  const stationLabel = (r: Fuel) => r.station || (r.external_id ? "—" : "Вручную");

  const rows: Row[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    return records
      .map(r => ({ ...r, truck: truckLabel(r), stationLabel: stationLabel(r) }))
      .filter(r => {
        const day = (r.date || "").slice(0, 10);
        if (dateFrom && day < dateFrom) return false;
        if (dateTo && day > dateTo) return false;
        if (stationF.size && !stationF.has(r.stationLabel)) return false;
        if (truckF.size && !truckF.has(r.truck)) return false;
        if (s && !`${r.stationLabel} ${r.card_number} ${r.truck}`.toLowerCase().includes(s)) return false;
        return true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, trucks, q, dateFrom, dateTo, stationF, truckF]);

  const totalVolume = rows.reduce((s, r) => s + (r.volume || 0), 0);
  const totalAmount = rows.reduce((s, r) => s + (r.amount || 0), 0);
  const stationOptions = useMemo(() => uniqueSorted(records.map(stationLabel)), [records]);
  const truckOptions = useMemo(() => uniqueSorted(records.map(truckLabel)), [records, trucks]);

  async function handleImport() {
    if (!importFile) return;
    setImporting(true); setError(null);
    try { const res = await api.upload<ImportSummary>("/api/fuel/import", importFile); setImportSummary(res); setImportFile(null); loadAll(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка импорта"); } finally { setImporting(false); }
  }
  async function handlePost() {
    setPosting(true); setError(null);
    try { const res = await api.post<PostSummary>("/api/fuel/post-to-expenses"); setPostSummary(res); setTimeout(() => setPostSummary(null), 5000); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка"); } finally { setPosting(false); }
  }
  async function handleAdd() {
    if (!aTruck || !aVolume || !aAmount) return;
    setSaving(true);
    try {
      await api.post("/api/fuel/", { external_id: "", date: `${aDate}T00:00:00`, station: aStation, card_number: "", truck_brand_raw: "", plate_raw: trucks.find(t => t.id === aTruck)?.plate || "", truck_id: aTruck, volume: Number(aVolume), amount: Number(aAmount), external_transaction_id: "" });
      setAddOpen(false); setAStation(""); setAVolume(""); setAAmount(""); loadAll();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка"); } finally { setSaving(false); }
  }

  const columns: Column<Row>[] = [
    { key: "date", label: "Дата", type: "date", width: "minmax(110px, 0.8fr)", sticky: true, strong: true, format: v => fmtDate((v as string || "").slice(0, 10)) },
    { key: "amount", label: "Сумма", type: "money", width: "minmax(120px, 0.9fr)", total: "sum" },
    { key: "volume", label: "Литры", type: "num", width: "minmax(100px, 0.8fr)", total: "sum", format: v => ((v as number) ? `${(v as number).toLocaleString("ru-RU")} л` : "—") },
    { key: "truck", label: "Машина", type: "id", width: "minmax(110px, 0.9fr)" },
    { key: "stationLabel", label: "Станция", type: "text", width: "minmax(160px, 1.6fr)" },
    { key: "card_number", label: "Карта", type: "id", width: "minmax(120px, 1fr)" },
  ];

  return (
    <div className="nd">
      <NdMenu active="finance" />
      <main className="main">
        {isPhone ? (
          <>
            <NdPhoneHead title="Топливо" subtitle={`заправок · ${records.length}`} onAdd={() => { setADate(isoDate(new Date())); setAddOpen(true); }} />
            <NdSectionTabs tabs={FINANCE_TABS} />
            <div className="nd-searchrow">
              <NdSearch value={q} onChange={setQ} placeholder="Станция, карта, машина…" />
              <NdFilterButton count={activeCount} onClick={() => setFiltersOpen(true)} />
              <button type="button" className="nd-searchrow__act" title="Импорт E100" onClick={() => { setImportSummary(null); setImportFile(null); setImportOpen(true); }}>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M8 1.5v8" /><path d="M4.7 6.2 8 9.5l3.3-3.3" /><path d="M2.4 12.5h11.2" /></svg>
              </button>
            </div>
          </>
        ) : (
          <>
            <header className="topbar">
              <div className="topbar__title"><h1 className="t-h1" style={{ margin: 0 }}>Топливо</h1><span className="t-mono muted">заправок · {records.length}</span></div>
              <div className="spacer" />
              <NdSearch value={q} onChange={setQ} placeholder="Станция, карта, машина…" width={240} />
            </header>
            <NdSectionTabs tabs={FINANCE_TABS} right={<>
              <button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Обычно" : "Компактно"}</button>
              <button className="btn btn--ghost" disabled={posting} onClick={handlePost}>{posting ? "…" : "Провести в расходы"}</button>
              <button className="btn btn--ghost" onClick={() => { setADate(isoDate(new Date())); setAddOpen(true); }}>Внести</button>
              <button className="btn btn--accent" onClick={() => { setImportSummary(null); setImportFile(null); setImportOpen(true); }}>Импорт E100</button>
            </>} />
          </>
        )}

        <div className="summarystrip">
          <div className="summary"><div className="summary__label">Заправок в выборке</div><div className="summary__value">{loading ? "…" : rows.length}</div></div>
          <div className="summary"><div className="summary__label">Литров</div><div className="summary__value">{loading ? "…" : `${Math.round(totalVolume).toLocaleString("ru-RU")} л`}</div></div>
          <div className="summary"><div className="summary__label">Сумма</div><div className="summary__value neg">{loading ? "…" : money(totalAmount)}</div></div>
        </div>

        {postSummary && <div style={{ margin: "10px 24px 0" }} className="act-warn"><span className="dot dot--ok" />Проведено: недель {postSummary.weeks}, новых строк в расходах {postSummary.created}</div>}

        <NdFilters open={filtersOpen} onClose={() => setFiltersOpen(false)} onReset={resetAllFilters} section="Топливо">
          <NdDateRange from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
          <NdMultiSelect label="Станция" options={stationOptions} selected={stationF} onChange={setStationF} />
          <NdMultiSelect label="Машина" options={truckOptions} selected={truckF} onChange={setTruckF} />
          <NdSortReset active={sorted} onReset={() => resetSortRef.current()} />
        </NdFilters>

        <div className={isPhone ? "nd-listwrap" : undefined} style={isPhone ? undefined : { flex: 1, minHeight: 0, padding: "12px 24px 20px", display: "flex", flexDirection: "column" }}>
          <NdDataTable<Row>
            columns={columns} rows={rows} loading={loading} dense={dense} select totals
            onSortActive={setSorted} resetRef={resetSortRef}
            sortKey="date" sortDir={-1} rowId={r => r.id}
            card={r => ({
              title: fmtDate((r.date as string || "").slice(0, 10)),
              right: <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--danger)" }}>{money(r.amount)}</div>,
              collapsible: true,
              facts: [
                { label: "Литры", value: r.volume ? `${(r.volume as number).toLocaleString("ru-RU")} л` : "—" },
                { label: "Машина", value: r.truck || "—" },
                { label: "Станция", value: r.stationLabel || "—" },
                { label: "Карта", value: r.card_number || "—" },
              ],
            })}
            empty={error ? "Не удалось загрузить" : "Заправок нет"} emptyHint={error ? "Проверьте доступ" : "Импортируйте выписку E100 или внесите вручную"}
            bulkActions={[{ label: "Удалить", onClick: async (ids, tapi) => { if (!window.confirm(`Удалить ${ids.length} записей?`)) return; let done = 0; for (const id of ids) { try { await api.delete(`/api/fuel/${id}`); done++; } catch { /* продолжаем, ошибку покажем ниже */ } } tapi.clearSelection(); loadAll(); if (done < ids.length) window.alert(`Удалено ${done} из ${ids.length}. Часть записей удалить не удалось — попробуйте ещё раз.`); } }]}
          />
        </div>
      </main>

      {importOpen && (
        <NdModal size="form" title="Импорт топлива E100" subtitle="Файл выписки .xlsx" onClose={() => setImportOpen(false)}
          actions={importSummary
            ? [{ label: "Готово", kind: "primary", grow: true, onClick: () => setImportOpen(false) }]
            : [{ label: "Отмена", kind: "ghost", onClick: () => setImportOpen(false) }, { label: importing ? "Импорт…" : "Импортировать", kind: "accent", grow: true, disabled: !importFile || importing, onClick: handleImport }]}>
          {importSummary ? (
            <div className="facts">
              <div className="facts__row"><span className="facts__label">Всего строк</span><span className="facts__value">{importSummary.total_rows}</span></div>
              <div className="facts__row"><span className="facts__label">Создано</span><span className="facts__value">{importSummary.records_created}</span></div>
              <div className="facts__row"><span className="facts__label">Обновлено</span><span className="facts__value">{importSummary.records_updated}</span></div>
              <div className="facts__row"><span className="facts__label">Пропущено</span><span className="facts__value">{importSummary.skipped_bad_rows}</span></div>
            </div>
          ) : (
            <div className="field"><span className="field__label">Файл .xlsx</span><input type="file" accept=".xlsx" onChange={e => setImportFile(e.target.files?.[0] || null)} style={{ font: "400 12.5px var(--font-ui)", color: "var(--ink)" }} />{error && <div className="field__error">{error}</div>}</div>
          )}
        </NdModal>
      )}

      {addOpen && (
        <NdModal size="form" title="Внести заправку" onClose={() => setAddOpen(false)}
          actions={[{ label: "Отмена", kind: "ghost", onClick: () => setAddOpen(false) }, { label: saving ? "…" : "Сохранить", kind: "accent", grow: true, disabled: !aTruck || !aVolume || !aAmount || saving, onClick: handleAdd }]}>
          <div className="field"><span className="field__label">Дата</span><input type="date" className="field__input" value={aDate} onChange={e => setADate(e.target.value)} /></div>
          <div className="field"><span className="field__label">Машина</span><select className="field__input" value={aTruck} onChange={e => setATruck(e.target.value ? Number(e.target.value) : "")}><option value="">— выберите —</option>{trucks.map(t => <option key={t.id} value={t.id}>{t.plate || t.label}</option>)}</select></div>
          <div className="field"><span className="field__label">Станция</span><input className="field__input" value={aStation} onChange={e => setAStation(e.target.value)} placeholder="необязательно" /></div>
          <div className="field"><span className="field__label">Литры</span><input type="number" className="field__input" value={aVolume} onChange={e => setAVolume(e.target.value)} /></div>
          <div className="field"><span className="field__label">Сумма, ₽</span><input type="number" className="field__input" value={aAmount} onChange={e => setAAmount(e.target.value)} /></div>
        </NdModal>
      )}
    </div>
  );
}
