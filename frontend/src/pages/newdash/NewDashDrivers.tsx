/**
 * NewDashDrivers — раздел «Водители» (/newdash/drivers).
 * Справочник водителей: таблица (NdDataTable) ⇄ плитки, анкета (форма NdModal
 * из секций), баланс, мобильный доступ, CRUD.
 * Данные: /api/drivers/ (+ /api/driver-transactions/balances).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import { fmtDate, money } from "../../lib/format";
import NdMenu from "./NdMenu";
import NdSortReset from "./NdSortReset";
import NdModal from "./NdModal";
import NdDataTable from "./NdDataTable";
import type { Column } from "./NdDataTable";
import { NdField, NdSearch } from "./shared";
import NdTxModal from "./NdTxModal";
import type { TxKind } from "./NdTxModal";
import { useAuth } from "../../auth/AuthContext";
import "./newdash.css";

type Driver = {
  id: number; name: string; phone: string; notes: string; active: boolean;
  mobile_app_enabled: boolean; mobile_login: string; mobile_password: string;
  last_name: string; first_name: string; middle_name: string; birth_date: string | null; birth_place: string; email: string;
  passport_number: string; passport_issued_date: string | null; passport_issued_by: string;
  registration_address: string; residence_address: string;
  license_number: string; license_issued_date: string | null; license_valid_until: string | null;
  skzi_card_number: string; skzi_issued_date: string | null; skzi_valid_until: string | null;
};
type Row = Driver & { fio: string; balance: number; tripsTotal: number; tripsWeek: number; mileage: number; rateList: DriverRate[] };
type DriverBalance = { driver_id: number; balance: number };
type Trip = { id: number; driver_id: number | null; dep_at: string; status: string };
type MileageEntry = { id: number; driver_id: number | null; odometer: number | null };
type LedgerEntry = { date: string; entry_type: string; amount: number; description: string };
type Carrier = { id: number; name: string };
type DriverRate = { id: number; driver_id: number; carrier_id: number; rate_type: string; rate_value: number; notes: string };
const RATE_TYPES: { value: string; label: string; unit: string }[] = [
  { value: "percentOfNet", label: "% от чистой выручки", unit: "%" },
  { value: "perTrip", label: "Сумма за рейс", unit: "₽/рейс" },
  { value: "perKm", label: "Сумма за км", unit: "₽/км" },
  { value: "salary", label: "Оклад (сумма/мес)", unit: "₽/мес" },
];
const rateLabel = (v: string) => RATE_TYPES.find(o => o.value === v)?.label || v;
const rateUnit = (v: string) => RATE_TYPES.find(o => o.value === v)?.unit || "";
// Короткая запись одного условия: «30%», «5 000 ₽/рейс», «12 ₽/км», «60 000 ₽/мес»
function rateShort(r: DriverRate): string {
  const v = r.rate_value.toLocaleString("ru-RU");
  return r.rate_type === "percentOfNet" ? `${v}%` : `${v} ${rateUnit(r.rate_type)}`;
}
// Сводка текущих условий работы водителя для строки/карточки.
// Нет условий → дефолт 30% от чистой выручки. Одинаковые по перевозчикам →
// одно значение (+ число перевозчиков). Разные → «разные · N перев.».
function condSummary(rs: DriverRate[]): { text: string; isDefault: boolean } {
  if (!rs.length) return { text: "30% от ЧВ", isDefault: true };
  const uniq = Array.from(new Set(rs.map(rateShort)));
  const suffix = rs.length > 1 ? ` · ${rs.length} перев.` : "";
  return { text: (uniq.length === 1 ? uniq[0] : "разные") + suffix, isDefault: false };
}
const TRIP_CANCELLED = "Отменено";
const TX_LABELS: Record<string, string> = {
  pnl_accrual: "Начислено", pnl_payment: "Выплачено", compensation: "Компенсация",
  advance: "Аванс", fine_pdd: "Штраф ПДД", fine_company: "Штраф от компании", payout: "Выплата", bonus: "Премия",
};

// Границы последней завершённой отчётной недели (пн–вс)
function lastReportingWeek() {
  const today = new Date();
  const day = today.getDay();
  const daysToMon = day === 0 ? 6 : day - 1;
  const thisMon = new Date(today); thisMon.setDate(today.getDate() - daysToMon); thisMon.setHours(0, 0, 0, 0);
  const start = new Date(thisMon); start.setDate(thisMon.getDate() - 7);
  const end = new Date(thisMon); end.setDate(thisMon.getDate() - 1); end.setHours(23, 59, 59, 999);
  return { start, end };
}

const fullName = (d: Driver) => [d.last_name, d.first_name, d.middle_name].filter(Boolean).join(" ") || d.name || "—";

type FS = {
  name: string; phone: string; notes: string; mobile_login: string; mobile_password: string;
  last_name: string; first_name: string; middle_name: string; birth_date: string; birth_place: string; email: string;
  passport_number: string; passport_issued_date: string; passport_issued_by: string; registration_address: string; residence_address: string;
  license_number: string; license_issued_date: string; license_valid_until: string;
  skzi_card_number: string; skzi_issued_date: string; skzi_valid_until: string;
  active: boolean; mobile_app_enabled: boolean;
};
const EMPTY: FS = {
  name: "", phone: "", notes: "", mobile_login: "", mobile_password: "",
  last_name: "", first_name: "", middle_name: "", birth_date: "", birth_place: "", email: "",
  passport_number: "", passport_issued_date: "", passport_issued_by: "", registration_address: "", residence_address: "",
  license_number: "", license_issued_date: "", license_valid_until: "",
  skzi_card_number: "", skzi_issued_date: "", skzi_valid_until: "",
  active: true, mobile_app_enabled: false,
};
function toForm(d: Driver): FS {
  return {
    name: d.name || "", phone: d.phone || "", notes: d.notes || "", mobile_login: d.mobile_login || "", mobile_password: d.mobile_password || "",
    last_name: d.last_name || "", first_name: d.first_name || "", middle_name: d.middle_name || "",
    birth_date: d.birth_date || "", birth_place: d.birth_place || "", email: d.email || "",
    passport_number: d.passport_number || "", passport_issued_date: d.passport_issued_date || "", passport_issued_by: d.passport_issued_by || "",
    registration_address: d.registration_address || "", residence_address: d.residence_address || "",
    license_number: d.license_number || "", license_issued_date: d.license_issued_date || "", license_valid_until: d.license_valid_until || "",
    skzi_card_number: d.skzi_card_number || "", skzi_issued_date: d.skzi_issued_date || "", skzi_valid_until: d.skzi_valid_until || "",
    active: d.active, mobile_app_enabled: d.mobile_app_enabled,
  };
}
function toPayload(f: FS) {
  const dOr = (s: string) => (s ? s : null);
  return {
    ...f,
    birth_date: dOr(f.birth_date), passport_issued_date: dOr(f.passport_issued_date),
    license_issued_date: dOr(f.license_issued_date), license_valid_until: dOr(f.license_valid_until),
    skzi_issued_date: dOr(f.skzi_issued_date), skzi_valid_until: dOr(f.skzi_valid_until),
  };
}

export default function NewDashDrivers() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [balances, setBalances] = useState<Map<number, number>>(new Map());
  const [rateMap, setRateMap] = useState<Map<number, DriverRate[]>>(new Map());
  const [trips, setTrips] = useState<Trip[]>([]);
  const [mileage, setMileage] = useState<MileageEntry[]>([]);
  // Реальный логин водителя = username его User-учётки. Тянем карту
  // driver_id -> username, чтобы показать в поле «Логин» действующий логин
  // (а не мёртвое Driver.mobile_login). Список пользователей — admin-only,
  // поэтому у не-админа карта пустая (управление учётками им и так закрыто).
  const [loginMap, setLoginMap] = useState<Map<number, string>>(new Map());
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hideInactive, setHideInactive] = useState(true);
  const [view, setView] = useState<"table" | "tiles">("table");
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});

  const [editId, setEditId] = useState<number | null>(null);   // null закрыто, 0 новый, >0 правка
  const [form, setForm] = useState<FS>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Выписка баланса
  const [ledgerFor, setLedgerFor] = useState<Driver | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [txModal, setTxModal] = useState<TxKind | null>(null);
  // Пароль водителя = пароль его User-учётки. Сброс/создание — только через
  // /create-account (сервер генерит пароль и пишет User.password_hash). Запись
  // в Driver.mobile_password для входа НЕ используется (мёртвое поле).
  async function resetPassword(d: Driver, login?: string) {
    // login — желаемый логин из поля «Логин». Пусто -> сервер берёт телефон
    // (при создании) или оставляет текущий (при сбросе).
    const wanted = (login || "").trim();
    try {
      const r = await api.post<{ username: string; password: string; reset: boolean }>(
        `/api/drivers/${d.id}/create-account`, wanted ? { login: wanted } : {});
      try { await navigator.clipboard?.writeText(r.password); } catch { /* clipboard недоступен */ }
      setLoginMap(m => { const n = new Map(m); n.set(d.id, r.username); return n; });
      setForm(f => ({ ...f, mobile_login: r.username }));
      window.alert(`Учётка водителя ${fullName(d)}\nЛогин: ${r.username}\nПароль: ${r.password}\n\n${r.reset ? "Пароль сброшен" : "Аккаунт создан"}. Пароль скопирован в буфер — передайте водителю (повторно не отобразится).`);
    } catch (e) { window.alert(e instanceof ApiError ? e.message : "Не удалось сбросить пароль"); }
  }
  function exportLedger(d: Driver, L: LedgerEntry[]) {
    // экранируем от CSV formula-injection: ячейку, начинающуюся с = + - @, префиксуем '
    const cell = (c: string) => { let x = String(c ?? ""); if (/^[=+\-@]/.test(x)) x = "'" + x; return `"${x.replace(/"/g, '""')}"`; };
    const rows = [["Дата", "Операция", "Сумма", "Комментарий"], ...L.map(e => [e.date, TX_LABELS[e.entry_type] || e.entry_type, String(e.amount), e.description || ""])];
    const csv = "﻿" + rows.map(r => r.map(cell).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `vypiska_${fullName(d).replace(/\s+/g, "_")}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  const opDot = (t: string) => t.includes("fine") ? "crit" : t === "advance" ? "warn" : (t === "pnl_accrual" || t === "bonus" || t === "compensation") ? "ok" : "off";
  function openLedger(d: Driver) {
    setLedgerFor(d); setLedger(null);
    api.get<LedgerEntry[]>(`/api/driver-transactions/full-ledger?driver_id=${d.id}`).then(setLedger).catch(() => setLedger([]));
  }
  function onTxSaved() {
    setTxModal(null);
    api.get<DriverBalance[]>("/api/driver-transactions/balances").then(b => setBalances(new Map(b.map(x => [x.driver_id, x.balance])))).catch(() => {});
    if (ledgerFor) openLedger(ledgerFor);
  }

  // Условия оплаты (в анкете существующего водителя)
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [rates, setRates] = useState<DriverRate[]>([]);
  const [rCarrier, setRCarrier] = useState("");
  const [rType, setRType] = useState("percentOfNet");
  const [rValue, setRValue] = useState("");
  const [rateBusy, setRateBusy] = useState(false);
  const carrierName = (id: number) => carriers.find(c => c.id === id)?.name || `#${id}`;
  function loadRates(driverId: number) {
    api.get<DriverRate[]>(`/api/driver-rates/?driver_id=${driverId}`).then(setRates).catch(() => setRates([]));
  }
  // Все условия оплаты разом — для колонки/карточки «Условия работы».
  function loadRateMap() {
    api.get<DriverRate[]>("/api/driver-rates/").then(rs => {
      const m = new Map<number, DriverRate[]>();
      rs.forEach(r => { const a = m.get(r.driver_id) || []; a.push(r); m.set(r.driver_id, a); });
      setRateMap(m);
    }).catch(() => {});
  }
  async function addRate() {
    if (!editId || !rCarrier || rValue === "" || Number.isNaN(Number(rValue))) return;
    setRateBusy(true);
    try {
      await api.post("/api/driver-rates/", { driver_id: editId, carrier_id: Number(rCarrier), rate_type: rType, rate_value: Number(rValue), notes: "" });
      setRValue(""); loadRates(editId); loadRateMap();
    } catch { /* тихо */ } finally { setRateBusy(false); }
  }
  async function delRate(id: number) {
    if (!editId) return;
    try { await api.delete(`/api/driver-rates/${id}`); loadRates(editId); loadRateMap(); } catch { /* тихо */ }
  }

  function loadAll() {
    setLoading(true);
    api.get<Driver[]>("/api/drivers/")
      .then(d => { setDrivers(d); setError(null); })
      .catch(e => setError(e instanceof ApiError ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
    api.get<DriverBalance[]>("/api/driver-transactions/balances").then(b => setBalances(new Map(b.map(x => [x.driver_id, x.balance])))).catch(() => {});
    api.get<Trip[]>("/api/trips/").then(setTrips).catch(() => {});
    api.get<MileageEntry[]>("/api/mileage-logs/").then(setMileage).catch(() => {});
    api.get<Carrier[]>("/api/carriers/").then(setCarriers).catch(() => {});
    if (isAdmin) {
      api.get<{ id: number; username: string; driver_id: number | null }[]>("/api/users/")
        .then(us => setLoginMap(new Map(us.filter(u => u.driver_id != null).map(u => [u.driver_id as number, u.username]))))
        .catch(() => {});
    }
    loadRateMap();
  }
  useEffect(() => { loadAll(); }, []);

  // счётчики рейсов (всего / отчётная неделя) + пробег на водителя
  const stats = useMemo(() => {
    const { start, end } = lastReportingWeek();
    const m = new Map<number, { total: number; week: number; mileage: number }>();
    const get = (id: number) => { let c = m.get(id); if (!c) { c = { total: 0, week: 0, mileage: 0 }; m.set(id, c); } return c; };
    for (const t of trips) {
      if (t.driver_id == null || t.status === TRIP_CANCELLED) continue;
      const c = get(t.driver_id); c.total += 1;
      const dep = new Date(t.dep_at); if (dep >= start && dep <= end) c.week += 1;
    }
    // пробег: размах одометра по записям водителя (max − min)
    const byDriver = new Map<number, number[]>();
    for (const e of mileage) { if (e.driver_id == null || e.odometer == null) continue; const a = byDriver.get(e.driver_id) || []; a.push(e.odometer); byDriver.set(e.driver_id, a); }
    byDriver.forEach((odos, id) => { if (odos.length >= 2) get(id).mileage = Math.max(...odos) - Math.min(...odos); });
    return m;
  }, [trips, mileage]);

  const rows: Row[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    return drivers
      .filter(d => (!hideInactive || d.active))
      .map(d => { const st = stats.get(d.id); return { ...d, fio: fullName(d), balance: balances.get(d.id) ?? 0, tripsTotal: st?.total ?? 0, tripsWeek: st?.week ?? 0, mileage: st?.mileage ?? 0, rateList: rateMap.get(d.id) ?? [] }; })
      .filter(r => !s || `${r.fio} ${r.phone} ${r.email}`.toLowerCase().includes(s))
      .sort((a, b) => a.fio.localeCompare(b.fio, "ru"));
  }, [drivers, balances, stats, rateMap, q, hideInactive]);

  const setF = (k: keyof FS, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  function openCreate() { setForm(EMPTY); setFormError(null); setRates([]); setEditId(0); }
  function openEdit(d: Driver) {
    // В поле «Логин» показываем действующий логин учётки (если создана),
    // иначе — легаси-значение из карточки. Это же значение уйдёт в
    // /create-account как желаемый username.
    setForm({ ...toForm(d), mobile_login: loginMap.get(d.id) ?? (d.mobile_login || "") });
    setFormError(null); setEditId(d.id);
    setRates([]); setRCarrier(""); setRType("percentOfNet"); setRValue("");
    loadRates(d.id);
  }
  async function handleSave() {
    if (!form.last_name.trim() && !form.name.trim()) { setFormError("Укажите фамилию или имя"); return; }
    setSaving(true); setFormError(null);
    try {
      const payload = toPayload(form);
      if (editId) await api.put(`/api/drivers/${editId}`, payload);
      else await api.post("/api/drivers/", payload);
      setEditId(null); loadAll();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  }
  async function handleDelete() {
    if (!editId) return;
    if (!window.confirm("Удалить водителя?")) return;
    setSaving(true);
    try { await api.delete(`/api/drivers/${editId}`); setEditId(null); loadAll(); }
    catch (e) { setFormError(e instanceof ApiError ? e.message : "Ошибка удаления"); }
    finally { setSaving(false); }
  }

  const columns: Column<Row>[] = [
    { key: "fio", label: "ФИО", type: "text", width: "minmax(180px, 1fr)", strong: true },
    { key: "phone", label: "Телефон", type: "id", width: "148px" },
    { key: "active", label: "Статус", type: "status", width: "116px", tone: r => (r.active ? "ok" : "idle"), format: (_v, r) => (r ? (r.active ? "Активен" : "Неактивен") : "") },
    { key: "tripsTotal", label: "Рейсов", type: "num", width: "90px" },
    { key: "tripsWeek", label: "За неделю", type: "num", width: "96px" },
    { key: "mileage", label: "Пробег, км", type: "num", width: "116px", format: v => ((v as number) > 0 ? (v as number).toLocaleString("ru-RU") : "—") },
    {
      key: "conditions", label: "Условия работы", type: "text", width: "minmax(150px, 0.9fr)",
      sortValue: r => condSummary(r.rateList).text,
      render: r => { const c = condSummary(r.rateList); return <span className={c.isDefault ? "muted" : undefined} title="Текущие условия оплаты по перевозчикам">{c.text}</span>; },
    },
    {
      key: "balance", label: "Баланс", type: "money", width: "150px",
      render: r => (
        <button type="button" onClick={e => { e.stopPropagation(); openLedger(r); }}
          style={{ border: 0, background: "none", cursor: "pointer", font: "inherit", display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color: r.balance < 0 ? "var(--danger)" : r.balance > 0 ? "var(--success-strong)" : "var(--text-3)" }}>
          {money(r.balance)} <span style={{ color: "var(--accent-ink)", fontSize: 11 }}>↗</span>
        </button>
      ),
    },
  ];

  return (
    <div className="nd">
      <NdMenu active="drivers" />
      <main className="main">
        <header className="topbar">
          <div className="topbar__title">
            <h1 className="t-h1" style={{ margin: 0 }}>Водители</h1>
            <span className="t-mono muted">штат · {drivers.length}</span>
          </div>
          <div className="spacer" />
          <NdSearch value={q} onChange={setQ} placeholder="ФИО, телефон…" width={240} />
          <button type="button" className="switch" aria-pressed={!hideInactive} onClick={() => setHideInactive(v => !v)}>
            <span className="switch__track"><span className="switch__knob" /></span>
            Неактивные
          </button>
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
            <NdDataTable<Row>
              columns={columns} rows={rows} loading={loading} rowId={r => r.id}
              onSortActive={setSorted} resetRef={resetSortRef}
              sortKey="fio" sortDir={1}
              onRowClick={r => openEdit(r)}
              empty={error ? "Не удалось загрузить" : "Водителей нет"} emptyHint={error ? "Проверьте доступ" : "Добавьте первого водителя"}
            />
          ) : loading ? (
            <div className="t-body-s muted" style={{ padding: 40, textAlign: "center" }}>Загрузка…</div>
          ) : (
            <div className="cards-grid">
              {rows.map(d => (
                <div key={d.id} className="vcard" onClick={() => openEdit(d)}>
                  <div className="vcard__head">
                    <span className="avatar avatar--lg">{(d.fio.split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("") || "?").toUpperCase()}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="t-h3" style={{ marginBottom: 2 }}>{d.fio}</div>
                      <div className="t-mono muted" style={{ fontSize: 12 }}>{d.phone || "—"}</div>
                    </div>
                    <span className={`status status--${d.active ? "ok" : "idle"}`}>{d.active ? "Активен" : "Неактивен"}</span>
                  </div>
                  <div className="vcard__stats">
                    <div className="vcard__stat"><div className="l">Рейсов</div><div className="v">{d.tripsTotal}</div></div>
                    <div className="vcard__stat"><div className="l">За неделю</div><div className="v">{d.tripsWeek}</div></div>
                    <div className="vcard__stat"><div className="l">Пробег, км</div><div className="v" style={{ fontSize: 13 }}>{d.mileage > 0 ? d.mileage.toLocaleString("ru-RU") : "—"}</div></div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "0 2px 2px" }}>
                    <span className="t-mono-label">Условия работы</span>
                    {(() => { const c = condSummary(d.rateList); return <span className="t-body-s" style={{ fontWeight: 600, color: c.isDefault ? "var(--text-3)" : "var(--ink)" }}>{c.text}</span>; })()}
                  </div>
                  <div className="vcard__foot">
                    <button type="button" onClick={e => { e.stopPropagation(); openLedger(d); }}
                      style={{ border: 0, background: "var(--surface-2)", borderRadius: "var(--r-md)", padding: "8px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "space-between" }}>
                      <span className="t-mono-label">Баланс к выплате</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: d.balance < 0 ? "var(--danger)" : d.balance > 0 ? "var(--success-strong)" : "var(--text-3)" }}>{money(d.balance)} ↗</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Анкета водителя */}
      {editId !== null && (
        <NdModal
          size="sheet"
          head="dark"
          title={editId ? (fullName(drivers.find(d => d.id === editId) || ({} as Driver)) || "Водитель") : "Новый водитель"}
          subtitle={editId ? `Анкета водителя${form.phone ? " · " + form.phone : ""}` : "Заполните анкету"}
          avatar={(`${form.last_name[0] || ""}${form.first_name[0] || ""}` || "?").toUpperCase()}
          status={editId ? { label: form.active ? "Активен" : "Неактивен", tone: form.active ? "ok" : "idle" } : undefined}
          onClose={() => setEditId(null)}
          actions={[
            ...(editId ? [{ label: "Удалить", kind: "quiet" as const, onClick: handleDelete }] : []),
            { label: "Отмена", kind: "ghost", onClick: () => setEditId(null) },
            { label: saving ? "Сохранение…" : "Сохранить", kind: "accent", grow: true, disabled: saving, onClick: handleSave },
          ]}
        >
          <section className="section">
            <div className="t-mono-label section__title">Учётная запись</div>
            <div className="form-grid">
              <div className="field"><span className="field__label">Статус</span>
                <button type="button" className="switch" aria-pressed={form.active} onClick={() => setF("active", !form.active)} style={{ alignSelf: "flex-start" }}><span className="switch__track"><span className="switch__knob" /></span>{form.active ? "Активен" : "Неактивен"}</button>
              </div>
              <div className="field"><span className="field__label">Мобильное приложение</span>
                <button type="button" className="switch" aria-pressed={form.mobile_app_enabled} onClick={() => setF("mobile_app_enabled", !form.mobile_app_enabled)} style={{ alignSelf: "flex-start" }}><span className="switch__track"><span className="switch__knob" /></span>{form.mobile_app_enabled ? "Включено" : "Выключено"}</button>
              </div>
              <NdField label="Логин" v={form.mobile_login} on={v => setF("mobile_login", v)} placeholder="по умолчанию — телефон" />
              <NdField label="Телефон" v={form.phone} on={v => setF("phone", v)} />
              <div className="field form-grid__field--wide">
                <span className="field__label">Учётная запись водителя</span>
                <button type="button" className="btn btn--ghost" style={{ alignSelf: "flex-start" }} disabled={!editId}
                  onClick={() => { const d = drivers.find(x => x.id === editId); if (d) resetPassword(d, form.mobile_login); }}>
                  Создать аккаунт / сбросить пароль
                </button>
                <span className="t-caption muted" style={{ marginTop: 4 }}>
                  {editId
                    ? "Логин берётся из поля «Логин» (пусто — телефон водителя); применяется этой кнопкой — она же создаёт учётку, меняет логин и сбрасывает пароль. Пароль сервер сгенерирует и покажет один раз (нужны заполненные телефон и e-mail; сохраните карточку перед сбросом)."
                    : "Сначала сохраните водителя, затем создайте аккаунт."}
                </span>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="t-mono-label section__title">Личные данные</div>
            <div className="form-grid">
              <NdField label="Фамилия" v={form.last_name} on={v => setF("last_name", v)} />
              <NdField label="Имя" v={form.first_name} on={v => setF("first_name", v)} />
              <NdField label="Отчество" v={form.middle_name} on={v => setF("middle_name", v)} />
              <NdField label="Дата рождения" type="date" v={form.birth_date} on={v => setF("birth_date", v)} />
              <NdField label="E-mail" v={form.email} on={v => setF("email", v)} />
              <NdField label="Место рождения" wide v={form.birth_place} on={v => setF("birth_place", v)} />
            </div>
          </section>

          <section className="section">
            <div className="t-mono-label section__title">Паспорт</div>
            <div className="form-grid">
              <NdField label="Серия и номер" v={form.passport_number} on={v => setF("passport_number", v)} />
              <NdField label="Дата выдачи" type="date" v={form.passport_issued_date} on={v => setF("passport_issued_date", v)} />
              <NdField label="Кем выдан" wide v={form.passport_issued_by} on={v => setF("passport_issued_by", v)} />
              <NdField label="Адрес регистрации" wide v={form.registration_address} on={v => setF("registration_address", v)} />
              <NdField label="Адрес проживания" wide v={form.residence_address} on={v => setF("residence_address", v)} />
            </div>
          </section>

          <section className="section">
            <div className="t-mono-label section__title">Документы водителя</div>
            <div className="form-grid">
              <NdField label="ВУ №" v={form.license_number} on={v => setF("license_number", v)} />
              <NdField label="ВУ выдано" type="date" v={form.license_issued_date} on={v => setF("license_issued_date", v)} />
              <NdField label="ВУ до" type="date" v={form.license_valid_until} on={v => setF("license_valid_until", v)} />
              <NdField label="Карта СКЗИ №" v={form.skzi_card_number} on={v => setF("skzi_card_number", v)} />
              <NdField label="СКЗИ выдана" type="date" v={form.skzi_issued_date} on={v => setF("skzi_issued_date", v)} />
              <NdField label="СКЗИ до" type="date" v={form.skzi_valid_until} on={v => setF("skzi_valid_until", v)} />
            </div>
          </section>

          {!!editId && (
            <section className="section">
              <div className="t-mono-label section__title">Условия оплаты · по перевозчикам</div>
              {rates.length === 0
                ? <div className="t-body-s muted" style={{ marginBottom: 10 }}>Условий пока нет — по умолчанию 30% от чистой выручки.</div>
                : rates.map(r => (
                  <div key={r.id} className="facts__row">
                    <span style={{ flex: 1, fontWeight: 500 }}>{carrierName(r.carrier_id)}</span>
                    <span className="muted" style={{ flex: 1 }}>{rateLabel(r.rate_type)}</span>
                    <span className="facts__value" style={{ minWidth: 90 }}>{r.rate_value} {rateUnit(r.rate_type)}</span>
                    <button type="button" className="btn btn--quiet" style={{ color: "var(--danger)", padding: "4px 8px" }} onClick={() => delRate(r.id)}>✕</button>
                  </div>
                ))}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 110px auto", gap: 10, alignItems: "end", marginTop: 12 }}>
                <div className="field"><span className="field__label">Перевозчик</span>
                  <select className="field__input" value={rCarrier} onChange={e => setRCarrier(e.target.value)}><option value="">— выберите —</option>{carriers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                </div>
                <div className="field"><span className="field__label">Формат</span>
                  <select className="field__input" value={rType} onChange={e => setRType(e.target.value)}>{RATE_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                </div>
                <div className="field"><span className="field__label">Условие</span>
                  <input type="number" className="field__input" value={rValue} onChange={e => setRValue(e.target.value)} placeholder={rateUnit(rType)} />
                </div>
                <button type="button" className="btn btn--accent" disabled={!rCarrier || rValue === "" || rateBusy} onClick={addRate} style={{ height: 40 }}>Добавить</button>
              </div>
            </section>
          )}

          <section className="section">
            <div className="t-mono-label section__title">Примечание</div>
            <div className="field"><input className="field__input" value={form.notes} onChange={e => setF("notes", e.target.value)} placeholder="свободный текст" /></div>
          </section>

          {formError && <div className="field__error">{formError}</div>}
        </NdModal>
      )}

      {/* Выписка баланса */}
      {ledgerFor && (() => {
        const L = ledger || [];
        const nacisleno = L.filter(e => e.entry_type === "pnl_accrual" && e.amount > 0).reduce((s, e) => s + e.amount, 0);
        const uderzh = L.filter(e => e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);
        const bal = balances.get(ledgerFor.id) ?? 0;
        const dates = L.map(e => e.date).filter(Boolean).sort();
        const short = (d: string) => { const [y, m, dd] = d.slice(0, 10).split("-"); return `${dd}.${m}.${y.slice(2)}`; };
        const range = dates.length ? `${short(dates[0])} – ${short(dates[dates.length - 1])}` : "";
        return (
          <NdModal
            size="wide"
            head="dark"
            title={fullName(ledgerFor)}
            subtitle={`Выписка по балансу${range ? " · " + range : ""}`}
            avatar={(`${ledgerFor.last_name[0] || ""}${ledgerFor.first_name[0] || ""}` || "?").toUpperCase()}
            onClose={() => setLedgerFor(null)}
            bodyStyle={{ overflow: "hidden" }}
            headExtra={
              <>
                <div className="head-facts">
                  <div><div className="head-facts__label">Итого</div><div className="head-facts__value" style={{ fontSize: 22, fontWeight: 600, color: bal < 0 ? "var(--danger)" : "var(--accent)" }}>{bal > 0 ? "+" : ""}{money(bal)}</div></div>
                  <div><div className="head-facts__label">Начислено</div><div className="head-facts__value">{money(nacisleno)}</div></div>
                  <div><div className="head-facts__label">Удержано и выплачено</div><div className="head-facts__value">{money(uderzh)}</div></div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                  <button type="button" className="btn btn--onDossier" onClick={() => setTxModal("fine")}>Штраф</button>
                  <button type="button" className="btn btn--onDossier" onClick={() => setTxModal("advance")}>Аванс</button>
                  <button type="button" className="btn btn--onDossier" onClick={() => setTxModal("bonus")}>Премия</button>
                  <button type="button" className="btn btn--onDossier" onClick={() => setTxModal("payout")}>Выплата</button>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="btn btn--onDossier" onClick={() => resetPassword(ledgerFor)}>Сбросить пароль</button>
                </div>
              </>
            }
            actions={[
              { label: "Выгрузить выписку", kind: "ghost", onClick: () => exportLedger(ledgerFor, L) },
              { label: "Открыть анкету", kind: "ghost", onClick: () => { const d = ledgerFor; setLedgerFor(null); openEdit(d); } },
              { label: "Закрыть", kind: "primary", grow: true, onClick: () => setLedgerFor(null) },
            ]}
          >
            <div className="table-card" style={{ flex: 1, minHeight: 0 }}>
              <div className="table-scroll">
                <div className="table" style={{ gridTemplateColumns: "110px 1fr 140px minmax(220px, 1.4fr)" }}>
                  <div className="table__head">
                    <button className="table__th">Дата</button>
                    <button className="table__th">Операция</button>
                    <button className="table__th" style={{ justifyContent: "flex-end" }}>Сумма</button>
                    <button className="table__th">Комментарий</button>
                  </div>
                  {ledger === null ? (
                    <div className="table__td" style={{ gridColumn: "1/-1", color: "var(--text-3)" }}>Загрузка…</div>
                  ) : L.length === 0 ? (
                    <div style={{ gridColumn: "1/-1", padding: "40px 20px", textAlign: "center" }}><div className="t-h3" style={{ color: "var(--text-2)" }}>Операций пока нет</div><div className="t-body-s muted" style={{ marginTop: 6 }}>Баланс формируется из расчётов по рейсам.</div></div>
                  ) : L.map((e, i) => (
                    <div className="table__row" key={i}>
                      <div className="table__td table__td--mono">{fmtDate(e.date)}</div>
                      <div className="table__td"><span className={`dot dot--${opDot(e.entry_type)}`} />{TX_LABELS[e.entry_type] || e.entry_type}</div>
                      <div className="table__td table__td--num" style={{ color: e.amount > 0 ? "var(--success-strong)" : e.entry_type.includes("fine") ? "var(--danger)" : "var(--ink)" }}>{e.amount > 0 ? "+" : ""}{money(e.amount)}</div>
                      <div className="table__td muted">{e.description || "—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </NdModal>
        );
      })()}

      {/* Форма начисления/списания (единый NdTxModal) */}
      {txModal && ledgerFor && (
        <NdTxModal kind={txModal} driverId={ledgerFor.id} driverName={fullName(ledgerFor)} balance={balances.get(ledgerFor.id) ?? 0} onClose={() => setTxModal(null)} onSaved={onTxSaved} />
      )}
    </div>
  );
}
