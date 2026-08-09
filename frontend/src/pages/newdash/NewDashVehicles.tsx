/**
 * NewDashVehicles — раздел «Машины» (/newdash/cars).
 * Справочник авто на шаблоне: таблица (NdDataTable) ⇄ плитки, просмотр
 * документов, CRUD (форма NdModal) со сканами документов, активная сессия.
 * Данные: /api/trucks/ (+ fleet-stats, active-sessions).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, fileUrl, logDownload } from "../../api";
import { fmtDate } from "../../lib/format";
import { useAuth } from "../../auth/AuthContext";
import NdMenu from "./NdMenu";
import NdSortReset from "./NdSortReset";
import NdModal from "./NdModal";
import NdDataTable from "./NdDataTable";
import type { Column } from "./NdDataTable";
import { NdSearch } from "./shared";
import "./newdash.css";

const VEHICLE_TYPES = ["Грузовой", "Легковой", "Фура"];
const BODY_TYPES = ["Тент", "Рефрежиратор", "Изотерма", "Фургон", "Прицеп"];

type Truck = {
  id: number; label: string; plate: string; brand: string; year: number | null;
  vehicle_type: string; body_type: string; maintenance_interval_km: number | null;
  osago_date: string | null; kasko_date: string | null; tech_inspection_date: string | null;
  vin: string; chassis_number: string; pts_number: string; sts_number: string; sts_date: string | null;
  osago_number: string; kasko_number: string; tech_inspection_number: string;
  sts_scan: string; osago_scan: string; kasko_scan: string; tech_inspection_scan: string;
  moscow_pass_date: string | null; notes: string;
};
type TruckStat = { last_odometer: number | null; last_service_odometer: number | null; fuel_week_liters: number };
type ActiveSession = { session_id: number; truck_id: number; driver_id: number; driver_name: string; started_at: string };

type FormState = {
  brand: string; plate: string; vehicle_type: string; body_type: string; year: string;
  maintenance_interval_km: string; vin: string; chassis_number: string; pts_number: string;
  sts_number: string; sts_date: string; osago_number: string; osago_date: string;
  kasko_number: string; kasko_date: string; tech_inspection_number: string; tech_inspection_date: string;
  moscow_pass_date: string; notes: string;
};
const EMPTY_FORM: FormState = {
  brand: "", plate: "", vehicle_type: VEHICLE_TYPES[0], body_type: "", year: "",
  maintenance_interval_km: "", vin: "", chassis_number: "", pts_number: "",
  sts_number: "", sts_date: "", osago_number: "", osago_date: "",
  kasko_number: "", kasko_date: "", tech_inspection_number: "", tech_inspection_date: "",
  moscow_pass_date: "", notes: "",
};
function truckToForm(t: Truck): FormState {
  return {
    brand: t.brand || "", plate: t.plate || "", vehicle_type: t.vehicle_type || VEHICLE_TYPES[0], body_type: t.body_type || "",
    year: t.year != null ? String(t.year) : "", maintenance_interval_km: t.maintenance_interval_km != null ? String(t.maintenance_interval_km) : "",
    vin: t.vin || "", chassis_number: t.chassis_number || "", pts_number: t.pts_number || "",
    sts_number: t.sts_number || "", sts_date: t.sts_date || "", osago_number: t.osago_number || "", osago_date: t.osago_date || "",
    kasko_number: t.kasko_number || "", kasko_date: t.kasko_date || "", tech_inspection_number: t.tech_inspection_number || "", tech_inspection_date: t.tech_inspection_date || "",
    moscow_pass_date: t.moscow_pass_date || "", notes: t.notes || "",
  };
}
function toPayload(f: FormState) {
  const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
  const dOr = (s: string) => (s ? s : null);
  return {
    brand: f.brand, plate: f.plate, vehicle_type: f.vehicle_type, body_type: f.body_type,
    year: numOrNull(f.year), maintenance_interval_km: numOrNull(f.maintenance_interval_km),
    vin: f.vin, chassis_number: f.chassis_number, pts_number: f.pts_number,
    sts_number: f.sts_number, sts_date: dOr(f.sts_date), osago_number: f.osago_number, osago_date: dOr(f.osago_date),
    kasko_number: f.kasko_number, kasko_date: dOr(f.kasko_date), tech_inspection_number: f.tech_inspection_number, tech_inspection_date: dOr(f.tech_inspection_date),
    moscow_pass_date: dOr(f.moscow_pass_date), notes: f.notes,
  };
}
const displayName = (t: Truck) => t.brand || t.label || t.plate || "Без названия";
const isOverdue = (d: string | null) => !!d && new Date(d) < new Date();

// Прогресс до ТО из fleet-stats (одометр − одометр последнего ТО) / интервал
function maintProgress(t: Truck, st: TruckStat | undefined) {
  const cur = st?.last_odometer ?? null;
  const svc = st?.last_service_odometer ?? 0;
  const interval = t.maintenance_interval_km;
  if (!interval || cur == null) return null;
  const used = Math.max(0, cur - svc);
  const pct = Math.min(100, (used / interval) * 100);
  const remain = interval - used;
  const color = pct >= 90 ? "var(--danger)" : pct >= 70 ? "var(--warn)" : "var(--accent)";
  return { used, remain, pct, color };
}

// Прогресс-бар «до ТО»
function MaintBar({ t, st }: { t: Truck; st: TruckStat | undefined }) {
  const m = maintProgress(t, st);
  if (!m) return null;
  return (
    <div>
      <div className="probar"><div className="probar__fill" style={{ width: `${m.pct}%`, background: m.color }} /></div>
      <div className="probar-row">
        <span>пройдено {Math.round(m.used).toLocaleString("ru-RU")} км</span>
        <span style={{ color: m.remain <= 0 ? "var(--danger)" : undefined }}>{m.remain > 0 ? `до ТО ${Math.round(m.remain).toLocaleString("ru-RU")} км` : "ТО просрочено"}</span>
      </div>
    </div>
  );
}

export default function NewDashVehicles() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [stats, setStats] = useState<Map<number, TruckStat>>(new Map());
  const [sessions, setSessions] = useState<Map<number, ActiveSession>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"table" | "tiles">("table");
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});

  const [viewTruck, setViewTruck] = useState<Truck | null>(null);
  const [editId, setEditId] = useState<number | null>(null);      // null = закрыто, 0 = новый, >0 = редактирование
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [scans, setScans] = useState<Record<string, string>>({});
  const [scanBusy, setScanBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Удаление машины с подтверждением пароля админа (только admin)
  const [pwDelete, setPwDelete] = useState<{ id: number; label: string } | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  function loadAll() {
    setLoading(true);
    api.get<Truck[]>("/api/trucks/")
      .then(t => { setTrucks(t); setError(null); })
      .catch(e => setError(e instanceof ApiError ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
    api.get<Record<string, TruckStat>>("/api/trucks/fleet-stats").then(raw => setStats(new Map(Object.entries(raw).map(([k, v]) => [Number(k), v])))).catch(() => {});
    api.get<ActiveSession[]>("/api/vehicle-inspections/active-sessions").then(list => setSessions(new Map(list.map(s => [s.truck_id, s])))).catch(() => {});
  }
  useEffect(() => { loadAll(); }, []);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = !s ? trucks : trucks.filter(t => [displayName(t), t.plate, t.vehicle_type, t.body_type, t.sts_number].some(v => (v || "").toLowerCase().includes(s)));
    return [...list].sort((a, b) => displayName(a).localeCompare(displayName(b), "ru"));
  }, [trucks, q]);

  const setF = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }));

  function openCreate() { setForm(EMPTY_FORM); setScans({}); setFormError(null); setEditId(0); }
  function openEdit(t: Truck) {
    setForm(truckToForm(t));
    setScans({ sts_scan: t.sts_scan || "", osago_scan: t.osago_scan || "", kasko_scan: t.kasko_scan || "", tech_inspection_scan: t.tech_inspection_scan || "" });
    setFormError(null); setEditId(t.id);
  }
  async function handleSave() {
    if (!form.brand.trim() && !form.plate.trim()) { setFormError("Укажите название или гос. номер"); return; }
    setSaving(true); setFormError(null);
    try {
      if (editId) await api.put(`/api/trucks/${editId}`, toPayload(form));
      else await api.post("/api/trucks/", toPayload(form));
      setEditId(null); loadAll();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  }
  // Открыть подтверждение удаления паролем (только admin)
  function openDeletePrompt() {
    if (!editId || !isAdmin) return;
    setPwValue(""); setPwError(null);
    setPwDelete({ id: editId, label: form.brand ? `${form.brand} ${form.plate}`.trim() : form.plate || "машину" });
  }
  // Подтвердить пароль админа и удалить
  async function confirmDelete() {
    if (!pwDelete || !pwValue) return;
    setPwBusy(true); setPwError(null);
    try {
      await api.post("/api/auth/verify-password", { password: pwValue });   // 401 при неверном
      await api.delete(`/api/trucks/${pwDelete.id}`);
      setPwDelete(null); setEditId(null); loadAll();
    } catch (e) {
      setPwError(e instanceof ApiError ? e.message : "Ошибка удаления");
    } finally { setPwBusy(false); }
  }
  async function uploadScan(docType: "sts" | "osago" | "kasko" | "tech_inspection", file: File) {
    if (!editId) return;
    const key = `${docType}_scan`;
    setScanBusy(key);
    try { const res = await api.upload<{ filename: string }>(`/api/trucks/${editId}/scan/${docType}`, file); setScans(s => ({ ...s, [key]: res.filename })); }
    catch { /* тихо */ } finally { setScanBusy(null); }
  }

  const columns: Column<Truck>[] = [
    { key: "brand", label: "Название", type: "text", width: "minmax(150px, 1fr)", strong: true, format: (_v, r) => (r ? displayName(r) : "—") },
    { key: "plate", label: "Гос. номер", type: "id", width: "120px" },
    { key: "sts_number", label: "№ СТС", type: "id", width: "116px" },
    { key: "vehicle_type", label: "Вид", type: "text", width: "100px" },
    { key: "body_type", label: "Надстройка", type: "text", width: "120px" },
    { key: "year", label: "Год", type: "num", width: "72px" },
    { key: "odo", label: "Одометр", type: "num", width: "112px", format: (_v, r) => { const o = r && stats.get(r.id)?.last_odometer; return o != null ? `${Math.round(o).toLocaleString("ru-RU")} км` : "—"; } },
    { key: "osago_date", label: "ОСАГО", type: "date", width: "108px", format: v => fmtDate(v as string), cellTone: r => (isOverdue(r.osago_date) ? "neg" : undefined) },
    { key: "kasko_date", label: "КАСКО", type: "date", width: "108px", format: v => fmtDate(v as string), cellTone: r => (isOverdue(r.kasko_date) ? "neg" : undefined) },
    { key: "tech_inspection_date", label: "ТехОсмотр", type: "date", width: "116px", format: v => fmtDate(v as string), cellTone: r => (isOverdue(r.tech_inspection_date) ? "neg" : undefined) },
    { key: "driver", label: "Водитель", type: "text", width: "minmax(180px, 1fr)", format: (_v, r) => (r && sessions.get(r.id) ? `🟢 ${sessions.get(r.id)!.driver_name}` : "—") },
  ];

  const DOC_LIST = (t: Truck) => [
    { key: "sts", label: "СТС", number: t.sts_number, date: t.sts_date, scan: t.sts_scan },
    { key: "osago", label: "ОСАГО", number: t.osago_number, date: t.osago_date, scan: t.osago_scan },
    { key: "kasko", label: "КАСКО", number: t.kasko_number, date: t.kasko_date, scan: t.kasko_scan },
    { key: "tech", label: "КАРТА ТЕХОСМОТРА", number: t.tech_inspection_number, date: t.tech_inspection_date, scan: t.tech_inspection_scan },
    { key: "msk", label: "ПРОПУСК МСК", number: "", date: t.moscow_pass_date, scan: "" },
  ];

  return (
    <div className="nd">
      <NdMenu active="cars" />
      <main className="main">
        <header className="topbar">
          <div className="topbar__title">
            <h1 className="t-h1" style={{ margin: 0 }}>Машины</h1>
            <span className="t-mono muted">парк · {trucks.length}</span>
          </div>
          <div className="spacer" />
          <NdSearch value={q} onChange={setQ} placeholder="Название, гос. номер, СТС…" />
          <div className="viewtoggle">
            <button className="viewtoggle__btn" aria-pressed={view === "table"} title="Таблица" onClick={() => setView("table")}>
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><path d="M2 4h11M2 7.5h11M2 11h11" /></svg>
            </button>
            <button className="viewtoggle__btn" aria-pressed={view === "tiles"} title="Плитки" onClick={() => setView("tiles")}>
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.7}><rect x="2" y="2" width="4.5" height="4.5" rx="1" /><rect x="8.5" y="2" width="4.5" height="4.5" rx="1" /><rect x="2" y="8.5" width="4.5" height="4.5" rx="1" /><rect x="8.5" y="8.5" width="4.5" height="4.5" rx="1" /></svg>
            </button>
          </div>
          {view === "table" && <NdSortReset active={sorted} onReset={() => resetSortRef.current()} />}
          <button className="btn btn--accent" onClick={openCreate}>Добавить</button>
        </header>

        <div style={{ flex: 1, minHeight: 0, padding: "16px 24px 20px", display: "flex", flexDirection: "column", overflow: view === "tiles" ? "auto" : "hidden" }}>
          {view === "table" ? (
            <NdDataTable<Truck>
              columns={columns} rows={rows} loading={loading} rowId={r => r.id}
              onSortActive={setSorted} resetRef={resetSortRef}
              sortKey="brand" sortDir={1}
              onRowClick={r => setViewTruck(r)}
              empty={error ? "Не удалось загрузить" : "Машин нет"} emptyHint={error ? "Проверьте доступ" : "Добавьте первую машину"}
            />
          ) : loading ? (
            <div className="t-body-s muted" style={{ padding: 40, textAlign: "center" }}>Загрузка…</div>
          ) : (
            <div className="cards-grid">
              {rows.map(t => {
                const st = stats.get(t.id); const sess = sessions.get(t.id);
                return (
                  <div key={t.id} className="vcard" onClick={() => setViewTruck(t)}>
                    <div className="vcard__head">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="t-h3" style={{ marginBottom: 2 }}>{displayName(t)}</div>
                        <div className="t-mono muted" style={{ fontSize: 12 }}>{t.plate || "—"}{t.body_type ? ` · ${t.body_type}` : ""}</div>
                      </div>
                      {sess && <span className="status status--ok">🟢 {sess.driver_name}</span>}
                    </div>
                    <div className="vcard__stats">
                      <div className="vcard__stat"><div className="l">Одометр</div><div className="v">{st?.last_odometer != null ? `${Math.round(st.last_odometer).toLocaleString("ru-RU")}` : "—"}</div></div>
                      <div className="vcard__stat"><div className="l">Год</div><div className="v">{t.year ?? "—"}</div></div>
                      <div className="vcard__stat"><div className="l">Топл. нед.</div><div className="v">{st && st.fuel_week_liters > 0 ? `${st.fuel_week_liters} л` : "—"}</div></div>
                    </div>
                    <MaintBar t={t} st={st} />
                    <div className="vcard__foot">
                      <span className="t-caption" style={{ color: isOverdue(t.osago_date) ? "var(--danger)" : "var(--text-3)" }}>ОСАГО {fmtDate(t.osago_date)}</span>
                      <span className="t-caption" style={{ color: isOverdue(t.tech_inspection_date) ? "var(--danger)" : "var(--text-3)" }}>ТО {fmtDate(t.tech_inspection_date)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Просмотр — данные + документы */}
      {viewTruck && (() => {
        const t = viewTruck; const sess = sessions.get(t.id); const st = stats.get(t.id);
        const facts: [string, React.ReactNode][] = [
          ["Название", displayName(t)], ["Вид", t.vehicle_type || "—"], ["Надстройка", t.body_type || "—"],
          ["Год выпуска", t.year ?? "—"], ["VIN", t.vin || "—"], ["Шасси", t.chassis_number || "—"],
          ["№ ПТС / ЭПТС", t.pts_number || "—"], ["Интервал ТО", t.maintenance_interval_km != null ? `${t.maintenance_interval_km.toLocaleString("ru-RU")} км` : "—"],
          ["Одометр", st?.last_odometer != null ? `${Math.round(st.last_odometer).toLocaleString("ru-RU")} км` : "—"],
          ["Топливо за неделю", st && st.fuel_week_liters > 0 ? `${st.fuel_week_liters} л` : "—"],
          ["Активная сессия", sess ? `🟢 ${sess.driver_name}` : "нет"],
        ];
        return (
          <NdModal
            size="panel"
            head="dark"
            title={t.plate || displayName(t)}
            subtitle={[t.brand, t.year].filter(Boolean).join(" · ") || undefined}
            avatar="🚚"
            onClose={() => setViewTruck(null)}
            actions={[
              ...(isAdmin ? [{ label: "Удалить", kind: "quiet" as const, onClick: () => { setPwValue(""); setPwError(null); setViewTruck(null); setPwDelete({ id: t.id, label: (t.plate || displayName(t) || "машину").trim() }); } }] : []),
              { label: "Закрыть", kind: "ghost", onClick: () => setViewTruck(null) },
              { label: "Редактировать", kind: "accent", grow: true, onClick: () => { setViewTruck(null); openEdit(t); } },
            ]}
          >
            <section className="section">
              <div className="t-mono-label section__title">Данные</div>
              <div className="facts" style={{ marginBottom: maintProgress(t, st) ? 14 : 0 }}>
                {facts.map(([l, v]) => (
                  <div className="facts__row" key={l}><span className="facts__label">{l}</span><span className="facts__value">{v}</span></div>
                ))}
              </div>
              <MaintBar t={t} st={st} />
            </section>

            <section className="section">
              <div className="t-mono-label section__title">Документы</div>
              {DOC_LIST(t).map(doc => (
                <div key={doc.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--line-row)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t-mono-label">{doc.label}</div>
                    <div className="t-body" style={{ fontWeight: 600, marginTop: 2 }}>{doc.number || "Номер не указан"}</div>
                    {doc.date && <div className="t-caption" style={{ color: isOverdue(doc.date) ? "var(--danger)" : "var(--text-2)", marginTop: 1 }}>до {fmtDate(doc.date)}</div>}
                  </div>
                  {doc.scan
                    ? <a className="btn btn--primary" href={fileUrl(`/truck-scans/${doc.scan}`)} download target="_blank" rel="noreferrer" onClick={() => logDownload(doc.scan, "documents")} style={{ flexShrink: 0 }}>Скачать</a>
                    : <span className="btn" style={{ background: "var(--surface-2)", color: "var(--text-3)", flexShrink: 0 }}>Нет файла</span>}
                </div>
              ))}
            </section>
          </NdModal>
        );
      })()}

      {/* Создание / редактирование */}
      {editId !== null && (
        <NdModal
          size="sheet"
          title={editId ? "Карточка автомобиля" : "Новый автомобиль"}
          onClose={() => setEditId(null)}
          actions={[
            ...(editId && isAdmin ? [{ label: "Удалить", kind: "quiet" as const, onClick: openDeletePrompt }] : []),
            { label: "Отмена", kind: "ghost", onClick: () => setEditId(null) },
            { label: saving ? "Сохранение…" : "Сохранить", kind: "accent", grow: true, disabled: saving, onClick: handleSave },
          ]}
        >
          <section className="section">
            <div className="form-grid">
              <Field label="Название"><input className="field__input" value={form.brand} onChange={e => setF("brand", e.target.value)} /></Field>
              <Field label="Гос. номер"><input className="field__input" value={form.plate} onChange={e => setF("plate", e.target.value)} /></Field>
              <Field label="Вид"><select className="field__input" value={form.vehicle_type} onChange={e => setF("vehicle_type", e.target.value)}>{VEHICLE_TYPES.map(v => <option key={v}>{v}</option>)}</select></Field>
              <Field label="Надстройка"><select className="field__input" value={form.body_type} onChange={e => setF("body_type", e.target.value)}><option value="">— нет —</option>{BODY_TYPES.map(v => <option key={v}>{v}</option>)}</select></Field>
              <Field label="VIN"><input className="field__input" value={form.vin} onChange={e => setF("vin", e.target.value)} /></Field>
              <Field label="Шасси"><input className="field__input" value={form.chassis_number} onChange={e => setF("chassis_number", e.target.value)} /></Field>
              <Field label="№ ПТС / ЭПТС"><input className="field__input" value={form.pts_number} onChange={e => setF("pts_number", e.target.value)} /></Field>
              <Field label="Год выпуска"><input type="number" className="field__input" value={form.year} onChange={e => setF("year", e.target.value)} /></Field>
              <Field label="Интервал ТО, км"><input type="number" className="field__input" value={form.maintenance_interval_km} onChange={e => setF("maintenance_interval_km", e.target.value)} /></Field>
              <Field label="Примечание" wide><input className="field__input" value={form.notes} onChange={e => setF("notes", e.target.value)} /></Field>
            </div>
          </section>

          <section className="section">
            <div className="t-mono-label section__title">Документы</div>
            {([
              { dt: "sts", label: "СТС", num: "sts_number", date: "sts_date" },
              { dt: "osago", label: "ОСАГО", num: "osago_number", date: "osago_date" },
              { dt: "kasko", label: "КАСКО", num: "kasko_number", date: "kasko_date" },
              { dt: "tech_inspection", label: "ТехОсмотр", num: "tech_inspection_number", date: "tech_inspection_date" },
            ] as const).map(d => (
              <DocRow
                key={d.dt} label={d.label}
                number={form[d.num]} date={form[d.date]}
                scan={scans[`${d.dt}_scan`] || ""} busy={scanBusy === `${d.dt}_scan`} canUpload={!!editId}
                onNumber={v => setF(d.num, v)} onDate={v => setF(d.date, v)}
                onFile={f => uploadScan(d.dt, f)}
              />
            ))}
            <DocRow label="Пропуск МСК" number="" date={form.moscow_pass_date} scan="" busy={false} canUpload={false}
              onNumber={() => {}} onDate={v => setF("moscow_pass_date", v)} onFile={() => {}} />
            {!editId && <div className="t-caption muted" style={{ marginTop: 6 }}>Сканы можно прикрепить после первого сохранения.</div>}
          </section>

          {formError && <div className="field__error">{formError}</div>}
        </NdModal>
      )}

      {/* Подтверждение удаления паролем админа */}
      {pwDelete && (
        <NdModal
          size="form"
          title="Удаление автомобиля"
          subtitle={`«${pwDelete.label}» — действие необратимо. Связанные рейсы и заправки потеряют привязку.`}
          onClose={() => setPwDelete(null)}
          actions={[
            { label: "Отмена", kind: "ghost", onClick: () => setPwDelete(null) },
            { label: pwBusy ? "Удаление…" : "Удалить безвозвратно", kind: "accent", grow: true, disabled: pwBusy || !pwValue, onClick: confirmDelete },
          ]}
        >
          <div className="field">
            <span className="field__label">Пароль администратора</span>
            <input type="password" className="field__input" value={pwValue} autoFocus
              onChange={e => { setPwValue(e.target.value); setPwError(null); }}
              onKeyDown={e => { if (e.key === "Enter" && pwValue && !pwBusy) confirmDelete(); }}
              placeholder="Подтвердите свой пароль" />
          </div>
          {pwError && <div className="field__error" style={{ marginTop: 10 }}>{pwError}</div>}
        </NdModal>
      )}
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={"field" + (wide ? " form-grid__field--wide" : "")}>
      <span className="field__label">{label}</span>
      {children}
    </div>
  );
}

function DocRow({ label, number, date, scan, busy, canUpload, onNumber, onDate, onFile }: {
  label: string; number: string; date: string; scan: string; busy: boolean; canUpload: boolean;
  onNumber: (v: string) => void; onDate: (v: string) => void; onFile: (f: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "88px 1fr 150px 40px", gap: 10, alignItems: "end", padding: "8px 0" }}>
      <div className="t-mono-label" style={{ paddingBottom: 8 }}>{label}</div>
      <div className="field"><input className="field__input" value={number} onChange={e => onNumber(e.target.value)} placeholder="Номер" /></div>
      <div className="field"><input type="date" className="field__input" value={date} onChange={e => onDate(e.target.value)} /></div>
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <input type="file" accept=".jpg,.jpeg,.png,.pdf,.webp" style={{ display: "none" }} ref={fileRef} onChange={e => { const f = e.target.files?.[0]; if (f) { onFile(f); e.target.value = ""; } }} />
        {canUpload ? (
          <button type="button" className="icon-btn" title={scan ? "Заменить скан" : "Прикрепить скан"} disabled={busy} onClick={() => fileRef.current?.click()}
            style={{ color: scan ? "var(--success)" : undefined }}>
            {busy ? "…" : (
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M12.5 7.5 8 12a2.5 2.5 0 0 1-3.5-3.5l4.5-4.5a1.6 1.6 0 0 1 2.3 2.3l-4.6 4.6a.7.7 0 0 1-1-1l4.2-4.2" /></svg>
            )}
          </button>
        ) : <div style={{ width: 30, height: 30 }} />}
      </div>
    </div>
  );
}
