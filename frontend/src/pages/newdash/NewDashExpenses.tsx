/**
 * NewDashExpenses — раздел «Финансы» → «Реестр расходов» (/newdash/finance).
 * Двусторонний реестр CashFlowEntry (доход/расход) на шаблоне NdDataTable.
 * Данные: /api/expenses/ (+ trucks/drivers для подписей).
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

type Entry = {
  id: number; date: string; status: string; income: number; expense: number; bank: string; period: string;
  vat_pct: number; vat_amount: number; truck_id: number | null; driver_id: number | null;
  category: string; counterparty: string; purpose: string; created_by_username: string | null;
};
type Truck = { id: number; label: string; plate?: string };
type Driver = { id: number; name: string; last_name: string; first_name: string; middle_name: string };
type Row = Entry & { truck: string; driver: string };

const STATUSES = ["ОПЛАЧЕНО", "ПЛАН ОПЛАТ", "ПЛАН ПОСТУПЛЕНИЙ"];
const BANKS = ["АльфаКарта", "Альфабанк", "Личные", "Фирма", "Наличные"];
const CATEGORIES = ["Оплата перевозок", "Оплата аренды", "Техническое обслуживание", "Ремонт", "Ремонт внеплановый", "Тех осмотр", "Топливо", "Фот", "Займ", "Запчасти", "Штрафы", "НАЛОГИ", "КАСКО", "ОСАГО", "Платная дорога", "Расчёт с водителем", "Прочее"];
const driverFio = (d: Driver) => [d.last_name, d.first_name, d.middle_name].filter(Boolean).join(" ") || d.name || "—";
const statusTone = (s: string) => s === "ОПЛАЧЕНО" ? "ok" : s === "ПЛАН ОПЛАТ" ? "warn" : "idle";
const periodFromDate = (d: string) => { const [y, m] = (d || "").split("-"); return y && m ? `${m}-${y}` : ""; };

type FS = { date: string; status: string; income: string; expense: string; bank: string; vat_pct: string; truck_id: number | ""; driver_id: number | ""; category: string; counterparty: string; purpose: string };
type Counterparty = { id: number; name: string; inn: string; vat_rate: number };
const emptyForm = (): FS => ({ date: isoDate(new Date()), status: STATUSES[0], income: "", expense: "", bank: BANKS[0], vat_pct: "0", truck_id: "", driver_id: "", category: CATEGORIES[0], counterparty: "", purpose: "" });
const toForm = (e: Entry): FS => ({ date: e.date || "", status: e.status || STATUSES[0], income: e.income ? String(e.income) : "", expense: e.expense ? String(e.expense) : "", bank: e.bank || "", vat_pct: e.vat_pct != null ? String(e.vat_pct) : "0", truck_id: e.truck_id ?? "", driver_id: e.driver_id ?? "", category: e.category || "", counterparty: e.counterparty || "", purpose: e.purpose || "" });
const toPayload = (f: FS) => ({ date: f.date, status: f.status, income: Number(f.income) || 0, expense: Number(f.expense) || 0, bank: f.bank, period: periodFromDate(f.date), vat_pct: Number(f.vat_pct) || 0, truck_id: f.truck_id || null, driver_id: f.driver_id || null, category: f.category, counterparty: f.counterparty, purpose: f.purpose });

export default function NewDashExpenses() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dense, setDense] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => isoDate(new Date(Date.now() - 60 * 864e5)));
  const [dateTo, setDateTo] = useState(() => isoDate(new Date()));
  const [statusF, setStatusF] = useState<Set<string>>(new Set());
  const [bankF, setBankF] = useState<Set<string>>(new Set());
  const [catF, setCatF] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);   // моб. лист фильтров
  const isPhone = useIsPhone();
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});
  const activeCount = (statusF.size ? 1 : 0) + (bankF.size ? 1 : 0) + (catF.size ? 1 : 0) + (sorted ? 1 : 0);
  const resetAllFilters = () => {
    setStatusF(new Set()); setBankF(new Set()); setCatF(new Set());
    setDateFrom(isoDate(new Date(Date.now() - 60 * 864e5))); setDateTo(isoDate(new Date()));
    resetSortRef.current();
  };

  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FS>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function loadAll() {
    setLoading(true);
    api.get<Entry[]>("/api/expenses/").then(e => { setEntries(e); setError(null); }).catch(e => setError(e instanceof ApiError ? e.message : "Ошибка загрузки")).finally(() => setLoading(false));
    api.get<Truck[]>("/api/trucks/").then(setTrucks).catch(() => {});
    api.get<Driver[]>("/api/drivers/").then(setDrivers).catch(() => {});
    api.get<Counterparty[]>("/api/counterparties/").then(setCounterparties).catch(() => {});
  }
  useEffect(() => { loadAll(); }, []);

  const truckLabel = (id: number | null) => (id == null ? "—" : trucks.find(t => t.id === id)?.plate || trucks.find(t => t.id === id)?.label || `#${id}`);
  const driverName = (id: number | null) => { if (id == null) return "—"; const d = drivers.find(x => x.id === id); return d ? driverFio(d) : `#${id}`; };

  const rows: Row[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    return entries
      .map(e => ({ ...e, truck: truckLabel(e.truck_id), driver: driverName(e.driver_id) }))
      .filter(r => {
        const day = (r.date || "").slice(0, 10);
        if (dateFrom && day < dateFrom) return false;
        if (dateTo && day > dateTo) return false;
        if (statusF.size && !statusF.has(r.status)) return false;
        if (bankF.size && !bankF.has(r.bank || "—")) return false;
        if (catF.size && !catF.has(r.category || "—")) return false;
        if (s && !`${r.category} ${r.bank} ${r.counterparty} ${r.purpose} ${r.truck} ${r.driver}`.toLowerCase().includes(s)) return false;
        return true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, trucks, drivers, q, dateFrom, dateTo, statusF, bankF, catF]);

  const totalExpense = rows.reduce((s, r) => s + (r.expense || 0), 0);
  const totalIncome = rows.reduce((s, r) => s + (r.income || 0), 0);
  const bankOptions = useMemo(() => uniqueSorted(entries.map(e => e.bank || "—")), [entries]);
  const catOptions = useMemo(() => uniqueSorted(entries.map(e => e.category || "—")), [entries]);

  const setF = <K extends keyof FS>(k: K, v: FS[K]) => setForm(f => ({ ...f, [k]: v }));
  function openCreate() { setForm(emptyForm()); setFormError(null); setEditId(0); }
  function openEdit(e: Entry) { setForm(toForm(e)); setFormError(null); setEditId(e.id); }
  async function handleSave() {
    if (!Number(form.income) && !Number(form.expense)) { setFormError("Укажите доход или расход"); return; }
    setSaving(true); setFormError(null);
    try {
      if (editId) await api.put(`/api/expenses/${editId}`, toPayload(form)); else await api.post("/api/expenses/", toPayload(form));
      setEditId(null); loadAll();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  }
  async function handleDelete() {
    if (!editId) return;
    if (!window.confirm("Удалить операцию?")) return;
    setSaving(true);
    try { await api.delete(`/api/expenses/${editId}`); setEditId(null); loadAll(); }
    catch (e) { setFormError(e instanceof ApiError ? e.message : "Ошибка удаления"); }
    finally { setSaving(false); }
  }

  const columns: Column<Row>[] = [
    { key: "date", label: "Дата", type: "date", width: "108px", sticky: true, strong: true, format: v => fmtDate(v as string) },
    { key: "status", label: "Статус", type: "status", width: "150px", tone: r => statusTone(r.status) },
    { key: "income", label: "Доход", type: "money", width: "128px", total: "sum", cellTone: r => (r.income > 0 ? "pos" : "mute") },
    { key: "expense", label: "Расход", type: "money", width: "128px", total: "sum", cellTone: r => (r.expense > 0 ? "neg" : "mute") },
    { key: "category", label: "Статья", type: "text", width: "150px" },
    { key: "bank", label: "Банк", type: "id", width: "116px" },
    { key: "counterparty", label: "Контрагент", type: "text", width: "150px" },
    { key: "purpose", label: "Назначение", type: "text", width: "minmax(160px, 1fr)" },
    { key: "truck", label: "Машина", type: "id", width: "110px" },
    { key: "driver", label: "Водитель", type: "text", width: "140px" },
  ];

  return (
    <div className="nd">
      <NdMenu active="finance" />
      <main className="main">
        {isPhone ? (
          <>
            <NdPhoneHead title="Реестр расходов" subtitle={`операций · ${entries.length}`} onAdd={openCreate} />
            <NdSectionTabs tabs={FINANCE_TABS} />
            <div className="nd-searchrow">
              <NdSearch value={q} onChange={setQ} placeholder="Статья, контрагент, назначение…" />
              <NdFilterButton count={activeCount} onClick={() => setFiltersOpen(true)} />
            </div>
            <div className="nd-saldo">
              <div className="nd-saldo__top"><span className="nd-saldo__cap">Сальдо · выборка</span></div>
              <div className="nd-saldo__value">{loading ? "…" : money(totalIncome - totalExpense)}</div>
              <div className="nd-saldo__row">
                <div><div className="nd-saldo__lbl">Доход</div><div className="nd-saldo__sub">{money(totalIncome)}</div></div>
                <div><div className="nd-saldo__lbl">Расход</div><div className="nd-saldo__sub">{money(totalExpense)}</div></div>
              </div>
            </div>
          </>
        ) : (
          <>
            <header className="topbar">
              <div className="topbar__title"><h1 className="t-h1" style={{ margin: 0 }}>Реестр расходов</h1><span className="t-mono muted">операций · {entries.length}</span></div>
              <div className="spacer" />
              <NdSearch value={q} onChange={setQ} placeholder="Статья, контрагент, назначение…" />
            </header>
            <NdSectionTabs tabs={FINANCE_TABS} right={<>
              <button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Обычно" : "Компактно"}</button>
              <button className="btn btn--accent" onClick={openCreate}>Добавить</button>
            </>} />
            <div className="summarystrip">
              <div className="summary"><div className="summary__label">Операций в выборке</div><div className="summary__value">{loading ? "…" : rows.length}</div></div>
              <div className="summary"><div className="summary__label">Расход по выборке</div><div className="summary__value neg">{loading ? "…" : money(totalExpense)}</div></div>
              <div className="summary"><div className="summary__label">Доход по выборке</div><div className="summary__value" style={{ color: "var(--success-strong)" }}>{loading ? "…" : money(totalIncome)}</div></div>
            </div>
          </>
        )}

        <NdFilters open={filtersOpen} onClose={() => setFiltersOpen(false)} onReset={resetAllFilters} section="Финансы">
          <NdDateRange from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
          <NdMultiSelect label="Статус" options={STATUSES} selected={statusF} onChange={setStatusF} />
          <NdMultiSelect label="Банк" options={bankOptions} selected={bankF} onChange={setBankF} />
          <NdMultiSelect label="Статья" options={catOptions} selected={catF} onChange={setCatF} />
          <NdSortReset active={sorted} onReset={() => resetSortRef.current()} />
        </NdFilters>

        <div className={isPhone ? "nd-listwrap" : undefined} style={isPhone ? undefined : { flex: 1, minHeight: 0, padding: "12px 24px 20px", display: "flex", flexDirection: "column" }}>
          <NdDataTable<Row>
            columns={columns} rows={rows} loading={loading} dense={dense} select totals
            onSortActive={setSorted} resetRef={resetSortRef}
            sortKey="date" sortDir={-1} rowId={r => r.id}
            onRowClick={r => openEdit(r)}
            card={r => ({
              title: r.category || "Операция",
              subtitle: fmtDate(r.date),
              right: r.income > 0
                ? <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--success-strong)" }}>+{money(r.income)}</div>
                : <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--danger)" }}>−{money(r.expense)}</div>,
              collapsible: true,
              facts: [
                { label: "Статус", value: <span className={`status status--${statusTone(r.status)}`}>{r.status}</span> },
                { label: "Банк", value: r.bank || "—" },
                { label: "Контрагент", value: r.counterparty || "—" },
                { label: "Назначение", value: r.purpose || "—" },
                { label: "Машина", value: r.truck || "—" },
                { label: "Водитель", value: r.driver || "—" },
              ],
            })}
            empty={error ? "Не удалось загрузить" : "Операций нет"} emptyHint={error ? "Проверьте доступ" : "Смягчите фильтры или добавьте операцию"}
            bulkActions={[{ label: "Удалить", onClick: async (ids, tapi) => { if (!window.confirm(`Удалить ${ids.length} операц.?`)) return; let done = 0; for (const id of ids) { try { await api.delete(`/api/expenses/${id}`); done++; } catch { /* продолжаем, ошибку покажем ниже */ } } tapi.clearSelection(); loadAll(); if (done < ids.length) window.alert(`Удалено ${done} из ${ids.length}. Часть операций удалить не удалось — попробуйте ещё раз.`); } }]}
          />
        </div>
      </main>

      {editId !== null && (
        <NdModal size="sheet" title={editId ? "Операция" : "Новая операция"} onClose={() => setEditId(null)}
          actions={[
            ...(editId ? [{ label: "Удалить", kind: "quiet" as const, onClick: handleDelete }] : []),
            { label: "Отмена", kind: "ghost", onClick: () => setEditId(null) },
            { label: saving ? "Сохранение…" : "Сохранить", kind: "accent", grow: true, disabled: saving, onClick: handleSave },
          ]}>
          <section className="section">
            <div className="form-grid">
              <Sel label="Дата" type="date" v={form.date} on={v => setF("date", v)} />
              <Sel label="Статус" v={form.status} on={v => setF("status", v)} opts={STATUSES} />
              <Sel label="Статья" v={form.category} on={v => setF("category", v)} opts={CATEGORIES} />
              <Sel label="Банк" v={form.bank} on={v => setF("bank", v)} opts={BANKS} />
              <CpCombobox list={counterparties} value={form.counterparty}
                onChange={v => setF("counterparty", v)}
                onVat={v => setF("vat_pct", v)}
                onCreated={cp => setCounterparties(prev => [...prev, cp])} />
              <Sel label="Назначение" wide v={form.purpose} on={v => setF("purpose", v)} />
              <div className="field"><span className="field__label">Машина</span><select className="field__input" value={form.truck_id} onChange={e => setF("truck_id", e.target.value ? Number(e.target.value) : "")}><option value="">— нет —</option>{trucks.map(t => <option key={t.id} value={t.id}>{t.plate || t.label}</option>)}</select></div>
              <div className="field"><span className="field__label">Водитель</span><select className="field__input" value={form.driver_id} onChange={e => setF("driver_id", e.target.value ? Number(e.target.value) : "")}><option value="">— нет —</option>{drivers.map(d => <option key={d.id} value={d.id}>{driverFio(d)}</option>)}</select></div>
              <Sel label="Доход, ₽" type="number" v={form.income} on={v => setF("income", v)} />
              <Sel label="Расход, ₽" type="number" v={form.expense} on={v => setF("expense", v)} />
              <Sel label="НДС, %" type="number" v={form.vat_pct} on={v => setF("vat_pct", v)} />
            </div>
          </section>
          {formError && <div className="field__error">{formError}</div>}
        </NdModal>
      )}
    </div>
  );
}

function Sel({ label, v, on, type, wide, opts }: { label: string; v: string; on: (v: string) => void; type?: string; wide?: boolean; opts?: string[] }) {
  return (
    <div className={"field" + (wide ? " form-grid__field--wide" : "")}>
      <span className="field__label">{label}</span>
      {opts ? <select className="field__input" value={v} onChange={e => on(e.target.value)}>{opts.map(o => <option key={o}>{o}</option>)}</select>
        : <input type={type || "text"} className="field__input" value={v} onChange={e => on(e.target.value)} />}
    </div>
  );
}

// Контрагент из справочника: автокомплит по /api/counterparties/ + автозаполнение
// НДС по vat_rate выбранного + создание нового (POST) на лету. Порт старого
// CounterpartyCombobox (при переезде на /newdash поле стало обычным текстом — баг).
function CpCombobox({ list, value, onChange, onVat, onCreated }: {
  list: Counterparty[]; value: string; onChange: (n: string) => void; onVat: (v: string) => void; onCreated: (cp: Counterparty) => void;
}) {
  const [open, setOpen] = useState(false);
  const [inp, setInp] = useState(value);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setInp(value); }, [value]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const q = inp.trim().toLowerCase();
  const filtered = q ? list.filter(c => c.name.toLowerCase().includes(q)) : list;
  const exact = list.some(c => c.name.toLowerCase() === q);
  const showAdd = inp.trim() !== "" && !exact;
  const pick = (c: Counterparty) => { setInp(c.name); onChange(c.name); if (c.vat_rate) onVat(String(c.vat_rate)); setOpen(false); };
  const create = async () => {
    const name = inp.trim(); if (!name || creating) return;
    setCreating(true);
    try { const c = await api.post<Counterparty>("/api/counterparties/", { name, inn: "" }); setInp(c.name); onChange(c.name); onCreated(c); }
    catch { /* оставим введённое как есть */ } finally { setCreating(false); setOpen(false); }
  };
  return (
    <div className="field nd-fdrop" ref={ref}>
      <span className="field__label">Контрагент</span>
      <input className="field__input" value={inp} placeholder="Начните вводить…"
        onChange={e => { setInp(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} />
      {open && (filtered.length > 0 || showAdd) && (
        <div className="nd-fdrop__menu">
          {filtered.slice(0, 40).map(c => (
            <button key={c.id} type="button" className="nd-fdrop__item" onClick={() => pick(c)}>
              <span style={{ flex: 1 }}>{c.name}</span>
              {c.vat_rate ? <span className="muted t-caption">НДС {c.vat_rate}%</span> : null}
            </button>
          ))}
          {showAdd && (
            <button type="button" className="nd-fdrop__item" style={{ color: "var(--accent-ink)" }} onClick={create} disabled={creating}>
              ＋ Создать «{inp.trim()}»
            </button>
          )}
        </div>
      )}
    </div>
  );
}
