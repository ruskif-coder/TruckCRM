import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { api, ApiError, fileUrl } from "../api";
import FineModal from "../components/FineModal";
import Icon from "../components/Icon";
import MultiSelect from "../components/MultiSelect";
import { fmtDate, isoDate, money, uniqueSorted } from "../lib/format";
import Fuel from "./Fuel";

// «Топливо» (2026-06-28, «наведём порядок») — бывший самостоятельный раздел
// /fuel, теперь 2-я вкладка здесь (см. рендер вкладок в Expenses() ниже).
// Сама страница Fuel.tsx не дублируется - переиспользуется как есть, её
// pagehead уже убран (правка там же).
type ExpensesTabId = "registry" | "fuel" | "compensations";
const EXPENSES_TABS: { id: ExpensesTabId; label: string }[] = [
  { id: "registry", label: "Реестр расходов" },
  { id: "fuel", label: "Топливо" },
  { id: "compensations", label: "Заявки" },
];

// "Реестр расходов" - built 2026-06-20 from a real export (user-supplied
// "Реестр расходов.xlsx", sheet "CF"). Despite the name the sheet tracks
// both incoming and outgoing payments, not only expenses - income/expense
// are kept as two separate fields rather than one signed amount, matching
// the source file. Manual entry only (no Excel import - user confirmed via
// AskUserQuestion), with sort/filter on Банк/Период/Машина/Водитель/Статья,
// per-row copy/edit/delete, and multi-select rows with bulk field edit.
type CashFlowEntry = {
  id: number;
  date: string;
  status: string;
  income: number;
  expense: number;
  bank: string;
  period: string;
  vat_pct: number;
  vat_amount: number;
  truck_id: number | null;
  driver_id: number | null;
  category: string;
  counterparty: string;
  purpose: string;
  // Added 2026-07-12: кто внёс запись (имя пользователя или null для старых записей)
  created_by_username: string | null;
};

type Truck = { id: number; label: string; plate?: string };
type Driver = { id: number; name: string; last_name: string; first_name: string; middle_name: string };
type Counterparty = { id: number; name: string; inn: string; vat_rate: number };

// Mirrors models.CASHFLOW_STATUSES / CASHFLOW_BANKS / CASHFLOW_CATEGORIES
// (backend/app/models.py) - duplicated here the same way TRIP_SOURCES is
// duplicated into Trips.tsx, since there's no settings endpoint serving
// picklists yet. Banks/categories replaced 2026-06-23 with the company's
// real short lists (see models.py comment for why). "АльфаБанк Личные"
// split into "Альфабанк"/"Личные" and "Ремонт" added same day per user
// correction - keep in sync with models.py.
const STATUSES = ["ОПЛАЧЕНО", "ПЛАН ОПЛАТ", "ПЛАН ПОСТУПЛЕНИЙ"];
const BANKS = ["АльфаКарта", "Альфабанк", "Личные", "Фирма", "Наличные"];
// "Платная дорога" и "Расчёт с водителем" добавлены 2026-06-28 (план "кабинет
// водителя") в models.CASHFLOW_CATEGORIES, но этот дублирующий список не
// обновили тогда же - из-за этого обе статьи были недоступны при ручном
// выборе в форме новой операции (хотя сами проводки заводились мимо этой
// формы: толл - вручную в БД, расчёт с водителем - кнопкой в Отчётах).
const CATEGORIES = [
  "Оплата перевозок", "Оплата аренды", "Техническое обслуживание", "Ремонт", "Ремонт внеплановый",
  "Тех осмотр", "Топливо", "Фот", "Займ", "Запчасти", "Штрафы",
  "НАЛОГИ", "КАСКО", "ОСАГО", "Платная дорога", "Расчёт с водителем", "Прочее",
];

const PAGE_SIZES = [50, 100, 300, 500];

function driverFullName(d: Driver): string {
  const parts = [d.last_name, d.first_name, d.middle_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : d.name || "—";
}

function periodFromDate(d: string): string {
  if (!d) return "";
  const [y, m] = d.split("-");
  return y && m ? `${m}-${y}` : "";
}

type EntryFormState = {
  date: string;
  status: string;
  income: string;
  expense: string;
  bank: string;
  period: string;
  vat_pct: string;
  truck_id: number | "";
  driver_id: number | "";
  category: string;
  counterparty: string;
  purpose: string;
};

function emptyForm(): EntryFormState {
  const today = isoDate(new Date());
  return {
    date: today,
    status: STATUSES[0],
    income: "",
    expense: "",
    bank: "",
    period: periodFromDate(today),
    vat_pct: "0",
    truck_id: "",
    driver_id: "",
    category: "",
    counterparty: "",
    purpose: "",
  };
}

function entryToForm(e: CashFlowEntry): EntryFormState {
  return {
    date: (e.date || "").slice(0, 10),
    status: e.status || STATUSES[0],
    income: e.income ? String(e.income) : "",
    expense: e.expense ? String(e.expense) : "",
    bank: e.bank || "",
    period: e.period || "",
    vat_pct: e.vat_pct != null ? String(e.vat_pct) : "0",
    truck_id: e.truck_id ?? "",
    driver_id: e.driver_id ?? "",
    category: e.category || "",
    counterparty: e.counterparty || "",
    purpose: e.purpose || "",
  };
}

function toPayload(f: EntryFormState) {
  return {
    date: f.date,
    status: f.status,
    income: Number(f.income) || 0,
    expense: Number(f.expense) || 0,
    bank: f.bank,
    period: f.period,
    vat_pct: Number(f.vat_pct) || 0,
    truck_id: f.truck_id === "" ? null : f.truck_id,
    driver_id: f.driver_id === "" ? null : f.driver_id,
    category: f.category,
    counterparty: f.counterparty,
    purpose: f.purpose,
  };
}

type SortKey =
  | "date" | "status" | "income" | "expense" | "bank" | "period" | "vat_pct" | "vat_amount"
  | "truck" | "driver" | "category" | "counterparty" | "purpose" | "created_by_username";

type BulkField<T> = { enabled: boolean; value: T };
type BulkFormState = {
  bank: BulkField<string>;
  period: BulkField<string>;
  truck_id: BulkField<number | "">;
  driver_id: BulkField<number | "">;
  category: BulkField<string>;
};

function emptyBulkForm(): BulkFormState {
  return {
    bank: { enabled: false, value: "" },
    period: { enabled: false, value: "" },
    truck_id: { enabled: false, value: "" },
    driver_id: { enabled: false, value: "" },
    category: { enabled: false, value: "" },
  };
}

const iconBtnStyle: CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 15,
  padding: "2px 5px",
  color: "var(--smoke)",
};

const thStyle: CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--smoke)",
  background: "var(--bg, #f5f5f9)",
  borderBottom: "1px solid var(--border, #ebebef)",
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  borderBottom: "1px solid var(--border, #ebebef)",
  verticalAlign: "top",
};

// CounterpartyCombobox — autocomplete + inline create.
// При выборе существующего контрагента вызывает onVatChange с его vat_rate,
// чтобы автоматически проставить НДС в форме. При вводе нового названия —
// создаёт контрагента (POST /api/counterparties/) с пустым ИНН (требует
// дозаполнения в Справочниках), вызывает onCounterpartyCreated, чтобы
// обновить список в памяти без перезагрузки страницы.
function CounterpartyCombobox({
  counterparties,
  value,
  onChange,
  onVatChange,
  onCounterpartyCreated,
}: {
  counterparties: Counterparty[];
  value: string;
  onChange: (name: string) => void;
  onVatChange: (vatStr: string) => void;
  onCounterpartyCreated: (cp: Counterparty) => void;
}) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState(value);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Sync when parent resets the form
  useEffect(() => { setInputVal(value); }, [value]);

  const q = inputVal.trim().toLowerCase();
  const filtered = q
    ? counterparties.filter((cp) => cp.name.toLowerCase().includes(q))
    : counterparties;
  const exactMatch = counterparties.find((cp) => cp.name.toLowerCase() === q);
  const showAdd = inputVal.trim() !== "" && !exactMatch;

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  function selectExisting(cp: Counterparty) {
    setInputVal(cp.name);
    onChange(cp.name);
    if (cp.vat_rate) onVatChange(String(cp.vat_rate));
    setOpen(false);
  }

  async function createNew() {
    const name = inputVal.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const created = await api.post<Counterparty>("/api/counterparties/", { name, inn: "" });
      setInputVal(created.name);
      onChange(created.name);
      onCounterpartyCreated(created);
    } catch { /* пользователь сам увидит пустое поле */ }
    finally {
      setCreating(false);
      setOpen(false);
    }
  }

  const dropStyle: CSSProperties = {
    position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
    background: "#fff", border: "1px solid var(--border, #ebebef)",
    borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.12)",
    maxHeight: 220, overflowY: "auto", marginTop: 2,
  };
  const itemStyle: CSSProperties = {
    padding: "8px 14px", fontSize: 13, cursor: "pointer",
    borderBottom: "1px solid var(--border, #ebebef)",
  };

  return (
    <div ref={ref} style={{ flex: 1, minWidth: 160, position: "relative" }}>
      <label className="label">Контрагент</label>
      <input
        type="text"
        className="input"
        value={inputVal}
        placeholder="Начните вводить..."
        onChange={(e) => {
          setInputVal(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (filtered.length > 0 || showAdd) && (
        <div style={dropStyle}>
          {filtered.map((cp) => (
            <div
              key={cp.id}
              style={itemStyle}
              onMouseDown={() => selectExisting(cp)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg,#f5f5f9)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "")}
            >
              {cp.name}
              {cp.inn ? <span style={{ color: "var(--smoke)", fontSize: 11, marginLeft: 6 }}>ИНН {cp.inn}</span> : (
                <span style={{ color: "var(--ember,#e04)", fontSize: 11, marginLeft: 6 }}>Требует дозаполнения</span>
              )}
              {cp.vat_rate ? <span style={{ color: "var(--smoke)", fontSize: 11, marginLeft: 6 }}>НДС {cp.vat_rate}%</span> : null}
            </div>
          ))}
          {showAdd && (
            <div
              style={{ ...itemStyle, color: "var(--primary,#4f6ef7)", fontWeight: 600, borderBottom: "none" }}
              onMouseDown={createNew}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg,#f5f5f9)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "")}
            >
              {creating ? "Добавление..." : `+ Добавить «${inputVal.trim()}»`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Expenses() {
  const [tab, setTab] = useState<ExpensesTabId>("registry");
  const [entries, setEntries] = useState<CashFlowEntry[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return isoDate(d);
  });
  const [dateTo, setDateTo] = useState(() => isoDate(new Date()));

  const [bankFilter, setBankFilter] = useState<Set<string>>(new Set());
  // Период — единственный выбранный месяц в формате "MM-YYYY" (пустая строка = все)
  const [periodFilter, setPeriodFilter] = useState<string>("");
  const [truckFilter, setTruckFilter] = useState<Set<string>>(new Set());
  const [driverFilter, setDriverFilter] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(new Set());

  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<EntryFormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState<BulkFormState>(emptyBulkForm());
  const [bulkSaving, setBulkSaving] = useState(false);

  // Inline "add new entry" panel (page element, not a modal) - lives above
  // the registry table. Separate state from `form`/editingId (which now
  // only back the edit/copy modal) so an in-progress new-entry draft isn't
  // clobbered by clicking edit/copy on an existing row.
  const [newForm, setNewForm] = useState<EntryFormState>(emptyForm());
  const [newSaving, setNewSaving] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [fineOpen, setFineOpen] = useState(false); // «Выписать штраф» modal
  // Статьи расходов: загружаются из API /api/expense-categories/ (#145)
  const [categories, setCategories] = useState<string[]>(CATEGORIES);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  // Суммарный долг перед перевозчиками (balance > 0 → мы должны)
  const [carrierDebt, setCarrierDebt] = useState<number>(0);

  // Журнал заявок на компенсацию (вкладка «Заявки», 2026-07-04)
  type CompRow = {
    id: number; driver_id: number | null; truck_id: number | null;
    expense_date: string; amount: number; category: string;
    description: string; photo_paths: string; status: string;
    reject_reason: string; created_at: string;
    driver_name: string; truck_label: string;
    approved_by_username: string | null;
  };
  const [compList, setCompList] = useState<CompRow[]>([]);
  const [compLoading, setCompLoading] = useState(false);
  const [compError, setCompError] = useState<string | null>(null);
  const [rejectDialogId, setRejectDialogId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [compActing, setCompActing] = useState(false);

  async function loadCompensations() {
    setCompLoading(true); setCompError(null);
    try {
      setCompList(await api.get<CompRow[]>("/api/compensation-requests/journal/"));
    } catch { setCompError("Ошибка загрузки"); }
    finally { setCompLoading(false); }
  }

  async function approveComp(id: number) {
    setCompActing(true);
    try {
      await api.post(`/api/compensation-requests/${id}/approve`, {});
      await loadCompensations();
    } catch { /* игнорируем */ }
    finally { setCompActing(false); }
  }

  async function rejectComp(id: number) {
    setCompActing(true);
    try {
      await api.post(`/api/compensation-requests/${id}/reject`, { reason: rejectReason });
      setRejectDialogId(null); setRejectReason("");
      await loadCompensations();
    } catch { /* игнорируем */ }
    finally { setCompActing(false); }
  }

  useEffect(() => {
    if (tab === "compensations") loadCompensations();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      type ExpCat = { id: number; name: string; active: boolean };
      const [e, tr, dr, cats, cps, bal] = await Promise.all([
        api.get<CashFlowEntry[]>("/api/expenses/"),
        api.get<Truck[]>("/api/trucks/"),
        api.get<Driver[]>("/api/drivers/"),
        api.get<ExpCat[]>("/api/expense-categories/").catch(() => [] as ExpCat[]),
        api.get<Counterparty[]>("/api/counterparties/").catch(() => [] as Counterparty[]),
        api.get<{ balance: number }[]>("/api/carriers/balance/").catch(() => [] as { balance: number }[]),
      ]);
      setEntries(e);
      setTrucks(tr);
      setDrivers(dr);
      const names = cats.filter(c => c.active).map(c => c.name);
      if (names.length > 0) setCategories(names);
      setCounterparties(cps);
      // Долг = сумма положительных балансов (balance > 0 означает «мы должны перевозчику»)
      setCarrierDebt(bal.filter(r => r.balance > 0).reduce((s, r) => s + r.balance, 0));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const truckLabel = (e: CashFlowEntry) => trucks.find((t) => t.id === e.truck_id)?.plate || "—";
  const driverLabel = (e: CashFlowEntry) => {
    const d = drivers.find((x) => x.id === e.driver_id);
    return d ? driverFullName(d) : "—";
  };

  function openEdit(e: CashFlowEntry) {
    setEditingId(e.id);
    setForm(entryToForm(e));
    setFormError(null);
    setModalOpen(true);
  }

  function openCopy(e: CashFlowEntry) {
    setEditingId(null);
    setForm(entryToForm(e));
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function setField<K extends keyof EntryFormState>(key: K, value: EntryFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleDateChange(value: string) {
    setForm((f) => ({ ...f, date: value, period: f.period ? f.period : periodFromDate(value) }));
  }

  async function handleSave() {
    // CashFlowEntry.date has no default (always required), so still worth
    // guarding client-side against a cleared <input type="date">. NOTE: this
    // is NOT what caused the "date: Input should be None" error reported
    // 2026-06-23 - the user confirmed the date was filled in when it
    // happened. That was actually a pydantic v2 bug (backend/app/models.py:
    // a field literally named `date` annotated Optional[date] collided with
    // the `date` type name and got mis-resolved to NoneType-only) - fixed by
    // aliasing the import for that field. Keeping this guard anyway, it's a
    // reasonable safeguard either way.
    if (!form.date) {
      setFormError("Укажите дату");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = toPayload(form);
      if (editingId) {
        await api.put(`/api/expenses/${editingId}`, payload);
      } else {
        await api.post("/api/expenses/", payload);
      }
      setModalOpen(false);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  function setNewField<K extends keyof EntryFormState>(key: K, value: EntryFormState[K]) {
    setNewForm((f) => ({ ...f, [key]: value }));
  }

  function handleNewDateChange(value: string) {
    setNewForm((f) => ({ ...f, date: value, period: f.period ? f.period : periodFromDate(value) }));
  }

  async function handleAddNew() {
    if (!newForm.date) {
      setNewError("Укажите дату");
      return;
    }
    setNewSaving(true);
    setNewError(null);
    try {
      const payload = toPayload(newForm);
      await api.post("/api/expenses/", payload);
      setNewForm(emptyForm());
      await loadAll();
    } catch (err) {
      setNewError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally {
      setNewSaving(false);
    }
  }

  async function handleDeleteFromModal() {
    if (!editingId) return;
    if (!window.confirm("Удалить операцию?")) return;
    setSaving(true);
    setFormError(null);
    try {
      await api.delete(`/api/expenses/${editingId}`);
      setModalOpen(false);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Ошибка удаления");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRow(id: number) {
    if (!window.confirm("Удалить операцию?")) return;
    setError(null);
    try {
      await api.delete(`/api/expenses/${id}`);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка удаления");
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openBulkEdit() {
    setBulkForm(emptyBulkForm());
    setBulkModalOpen(true);
  }

  async function handleBulkSave() {
    const fields: Record<string, unknown> = {};
    if (bulkForm.bank.enabled) fields.bank = bulkForm.bank.value;
    if (bulkForm.period.enabled) fields.period = bulkForm.period.value;
    if (bulkForm.truck_id.enabled) fields.truck_id = bulkForm.truck_id.value === "" ? null : bulkForm.truck_id.value;
    if (bulkForm.driver_id.enabled) fields.driver_id = bulkForm.driver_id.value === "" ? null : bulkForm.driver_id.value;
    if (bulkForm.category.enabled) fields.category = bulkForm.category.value;
    if (Object.keys(fields).length === 0) {
      setBulkModalOpen(false);
      return;
    }
    setBulkSaving(true);
    setError(null);
    try {
      await api.patch("/api/expenses/bulk", { ids: Array.from(selectedIds), ...fields });
      setBulkModalOpen(false);
      setSelectedIds(new Set());
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка массового изменения");
    } finally {
      setBulkSaving(false);
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function Th({ label, sortKeyName }: { label: string; sortKeyName: SortKey }) {
    const active = sortKey === sortKeyName;
    return (
      <th
        onClick={() => toggleSort(sortKeyName)}
        style={{ cursor: "pointer", userSelect: "none", color: active ? "var(--iris)" : undefined, whiteSpace: "nowrap" }}
      >
        {label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </th>
    );
  }

  const bankOptions = uniqueSorted(entries.map((e) => e.bank).filter(Boolean));
  const truckOptions = uniqueSorted(entries.map(truckLabel).filter((v) => v !== "—"));
  const driverOptions = uniqueSorted(entries.map(driverLabel).filter((v) => v !== "—"));
  const categoryOptions = uniqueSorted(entries.map((e) => e.category).filter(Boolean));

  const filtered = entries.filter((e) => {
    const day = (e.date || "").slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    if (bankFilter.size > 0 && !bankFilter.has(e.bank)) return false;
    if (periodFilter && e.period !== periodFilter) return false;
    if (truckFilter.size > 0 && !truckFilter.has(truckLabel(e))) return false;
    if (driverFilter.size > 0 && !driverFilter.has(driverLabel(e))) return false;
    if (categoryFilter.size > 0 && !categoryFilter.has(e.category)) return false;
    return true;
  });

  function valueOf(e: CashFlowEntry, key: SortKey): string | number {
    if (key === "truck") return truckLabel(e);
    if (key === "driver") return driverLabel(e);
    if (key === "created_by_username") return e.created_by_username ?? "";
    return (e as Record<string, unknown>)[key] as string | number ?? "";
  }

  const sorted = [...filtered].sort((a, b) => {
    const av = valueOf(a, sortKey);
    const bv = valueOf(b, sortKey);
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "ru");
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalIncome = filtered.reduce((sum, e) => sum + e.income, 0);
  const totalExpense = filtered.reduce((sum, e) => sum + e.expense, 0);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const paged = sorted.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  const allPagedSelected = paged.length > 0 && paged.every((e) => selectedIds.has(e.id));
  function toggleSelectAllPaged() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPagedSelected) {
        paged.forEach((e) => next.delete(e.id));
      } else {
        paged.forEach((e) => next.add(e.id));
      }
      return next;
    });
  }

  // 2026-06-28 («выровнять вкладки и кнопки в одну строку») - переключатель
  // вкладок передаётся вниз как tabsNav вместо отдельной строки над
  // контентом, чтобы встать в одну строку с кнопкой действия активной
  // вкладки, а не тратить отдельную строку только на вкладки.
  const tabsNav = (
    <div className="navpills" style={{ width: "fit-content" }}>
      {EXPENSES_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={"navpill" + (tab === t.id ? " active" : "")}
          style={{ border: "none", background: tab === t.id ? undefined : "none", cursor: "pointer", font: "inherit" }}
          onClick={() => setTab(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <div className="pagehead">
        <div className="ph-title">
          <div className="crumbs">
            <Icon name="grid" size={13} /> Автопарк <Icon name="chevr" size={13} /> Финансы
          </div>
          <h1 className="pagetitle">Финансы</h1>
        </div>
      </div>

      <div key={tab} className="tab-panel">
      {tab === "fuel" && <Fuel tabsNav={tabsNav} />}

      {tab === "compensations" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {tabsNav}
            <button className="pill-btn" onClick={loadCompensations} disabled={compLoading}>
              ↻ Обновить
            </button>
          </div>

          {compError && (
            <p className="fcard" style={{ color: "var(--ember)", marginBottom: 16 }}>{compError}</p>
          )}

          {compLoading ? (
            <div className="fcard" style={{ textAlign: "center", color: "var(--smoke)", padding: "32px 0" }}>Загрузка...</div>
          ) : compList.length === 0 ? (
            <div className="fcard" style={{ textAlign: "center", color: "var(--smoke)", padding: "32px 0" }}>Заявок пока нет</div>
          ) : (
            <div className="fcard" style={{ padding: 0, overflow: "hidden" }}>
              <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Дата</th>
                    <th style={thStyle}>Водитель</th>
                    <th style={thStyle}>Машина</th>
                    <th style={thStyle}>Статья</th>
                    <th style={thStyle}>Сумма</th>
                    <th style={thStyle}>Описание</th>
                    <th style={thStyle}>Фото</th>
                    <th style={thStyle}>Статус</th>
                    <th style={thStyle}>Согласовал</th>
                    <th style={thStyle}>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {compList.map(row => {
                    const stMap: Record<string, { color: string; label: string }> = {
                      "на рассмотрении": { color: "var(--smoke)", label: "На рассмотрении" },
                      "принято":         { color: "var(--grass, #27ae60)", label: "Принято" },
                      "отказано":        { color: "var(--ember, #e74c3c)", label: "Отказано" },
                    };
                    const st = stMap[row.status] ?? { color: "var(--smoke)", label: row.status };
                    let photos: string[] = [];
                    try { photos = JSON.parse(row.photo_paths || "[]"); } catch { /* */ }
                    return (
                      <tr key={row.id}>
                        <td style={tdStyle}>{row.expense_date}</td>
                        <td style={tdStyle}>{row.driver_name}</td>
                        <td style={tdStyle}>{row.truck_label}</td>
                        <td style={tdStyle}>{row.category}</td>
                        <td style={tdStyle}>{Number(row.amount).toLocaleString("ru-RU")} ₽</td>
                        <td style={tdStyle}>{row.description || "—"}</td>
                        <td style={tdStyle}>
                          {photos.length > 0 ? (
                            <div style={{ display: "flex", gap: 6 }}>
                              {photos.map((p, i) => (
                                <a key={i} href={fileUrl(`/photos/${p}`)} target="_blank" rel="noreferrer"
                                  style={{ fontSize: 20, textDecoration: "none", lineHeight: 1 }}>📷</a>
                              ))}
                            </div>
                          ) : "—"}
                        </td>
                        <td style={tdStyle}>
                          <span style={{ color: st.color, fontWeight: 600 }}>{st.label}</span>
                          {row.status === "отказано" && row.reject_reason && (
                            <div style={{ fontSize: 11, color: "var(--smoke)", marginTop: 2 }}>{row.reject_reason}</div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, fontSize: 12, color: "var(--smoke)" }}>
                          {row.approved_by_username || "—"}
                        </td>
                        <td style={tdStyle}>
                          {row.status === "на рассмотрении" && (
                            <div style={{ display: "flex", gap: 6, whiteSpace: "nowrap" }}>
                              <button
                                className="pill-btn solid"
                                style={{ fontSize: 12, padding: "4px 10px", background: "var(--grass, #27ae60)", border: "none" }}
                                disabled={compActing}
                                onClick={() => approveComp(row.id)}
                              >
                                ✓ Принять
                              </button>
                              <button
                                className="pill-btn"
                                style={{ fontSize: 12, padding: "4px 10px", color: "var(--ember, #e74c3c)" }}
                                disabled={compActing}
                                onClick={() => { setRejectDialogId(row.id); setRejectReason(""); }}
                              >
                                ✕ Отказать
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Диалог отказа с причиной */}
          {rejectDialogId !== null && (
            <div style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
              display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000,
            }}>
              <div className="fcard" style={{ width: 400, maxWidth: "90vw", padding: 24 }}>
                <h3 style={{ margin: "0 0 14px", fontSize: 16 }}>Причина отказа</h3>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="необязательно"
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  style={{ width: "100%", resize: "vertical", marginBottom: 14 }}
                />
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button className="pill-btn" onClick={() => setRejectDialogId(null)}>Отмена</button>
                  <button
                    className="pill-btn solid"
                    style={{ background: "var(--ember, #e74c3c)", border: "none" }}
                    disabled={compActing}
                    onClick={() => rejectComp(rejectDialogId!)}
                  >
                    {compActing ? "..." : "Подтвердить"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "registry" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {tabsNav}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="pill-btn"
                style={{ color: "var(--ember, #e74c3c)" }}
                onClick={() => setFineOpen(true)}
              >
                Выписать штраф
              </button>
              <button className="pill-btn solid" onClick={() => setAddOpen(true)}>
                <Icon name="plus" size={17} /> <span className="lbl-hide">Добавить операцию</span>
              </button>
            </div>
          </div>

          {error && (
            <p className="fcard" style={{ color: "var(--ember)", marginBottom: 24 }}>
              {error}
            </p>
          )}

          {addOpen && (
        <div className="fcard" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, margin: "0 0 16px" }}>Новая операция</h2>

          <Row>
            <TextField label="Дата" type="date" value={newForm.date} onChange={handleNewDateChange} />
            <SelectField label="Статус" value={newForm.status} onChange={(v) => setNewField("status", v)} options={STATUSES} />
            <TextField label="Поступления" type="number" value={newForm.income} onChange={(v) => setNewField("income", v)} />
            <TextField label="Списания" type="number" value={newForm.expense} onChange={(v) => setNewField("expense", v)} />
            <SelectField
              label="Банк"
              value={newForm.bank}
              onChange={(v) => setNewField("bank", v)}
              options={BANKS}
              placeholder="Банк"
            />
            <TextField label="Период" value={newForm.period} onChange={(v) => setNewField("period", v)} />
          </Row>

          <Row>
            <TextField label="НДС, %" type="number" value={newForm.vat_pct} onChange={(v) => setNewField("vat_pct", v)} />
            <div style={{ flex: 1, minWidth: 160 }}>
              <label className="label">Машина</label>
              <select
                className="input"
                value={newForm.truck_id}
                onChange={(e) => setNewField("truck_id", e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Не выбрано</option>
                {trucks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label className="label">Водитель</label>
              <select
                className="input"
                value={newForm.driver_id}
                onChange={(e) => setNewField("driver_id", e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Не выбрано</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {driverFullName(d)}
                  </option>
                ))}
              </select>
            </div>
            <SelectField
              label="Статья"
              value={newForm.category}
              onChange={(v) => setNewField("category", v)}
              options={categories}
              placeholder="Статья"
            />
            <CounterpartyCombobox
              counterparties={counterparties}
              value={newForm.counterparty}
              onChange={(name) => setNewField("counterparty", name)}
              onVatChange={(v) => setNewField("vat_pct", v)}
              onCounterpartyCreated={(cp) => setCounterparties((prev) => [...prev, cp])}
            />
            <TextField label="Назначение" value={newForm.purpose} onChange={(v) => setNewField("purpose", v)} />
          </Row>

          {newError && <p style={{ color: "var(--ember)", fontSize: 13, margin: "0 0 12px" }}>{newError}</p>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="pill-btn" onClick={() => setAddOpen(false)}>
              Отмена
            </button>
            <button type="button" className="pill-btn solid" disabled={newSaving} onClick={handleAddNew}>
              {newSaving ? "Сохранение..." : "Добавить операцию"}
            </button>
          </div>
        </div>
      )}

      {/* Модалка «Выписать штраф» */}
      {fineOpen && (
        <FineModal
          drivers={drivers}
          onClose={() => setFineOpen(false)}
          onSaved={() => setFineOpen(false)}
        />
      )}

      <div className="fcard" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
          <div>
            <label className="label">С</label>
            <input
              type="date"
              className="input"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <label className="label">По</label>
            <input
              type="date"
              className="input"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <MultiSelect
            label="Банк"
            options={bankOptions}
            selected={bankFilter}
            onChange={(s) => {
              setBankFilter(s);
              setPage(1);
            }}
          />
          <div>
            <label className="label">Период</label>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                type="month"
                className="input"
                style={{ minWidth: 140 }}
                value={
                  // period хранится "MM-YYYY", input[type=month] ожидает "YYYY-MM"
                  periodFilter
                    ? `${periodFilter.slice(3)}-${periodFilter.slice(0, 2)}`
                    : ""
                }
                onChange={(e) => {
                  if (e.target.value) {
                    const [y, m] = e.target.value.split("-");
                    setPeriodFilter(`${m}-${y}`);
                  } else {
                    setPeriodFilter("");
                  }
                  setPage(1);
                }}
              />
              {periodFilter && (
                <button
                  title="Сбросить фильтр периода"
                  style={{ ...iconBtnStyle, fontSize: 18, color: "var(--smoke)" }}
                  onClick={() => { setPeriodFilter(""); setPage(1); }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
          <MultiSelect
            label="Машина"
            options={truckOptions}
            selected={truckFilter}
            onChange={(s) => {
              setTruckFilter(s);
              setPage(1);
            }}
          />
          <MultiSelect
            label="Водитель"
            options={driverOptions}
            selected={driverFilter}
            onChange={(s) => {
              setDriverFilter(s);
              setPage(1);
            }}
          />
          <MultiSelect
            label="Статья"
            options={categoryOptions}
            selected={categoryFilter}
            onChange={(s) => {
              setCategoryFilter(s);
              setPage(1);
            }}
          />
          <div>
            <label className="label">Строк на странице</label>
            <select
              className="input"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
        <div className="fcard" style={{ flex: 1 }}>
          <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 4px" }}>Долг перевозчиков</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0, color: carrierDebt > 0 ? "var(--ember,#e04)" : undefined }}>
            {money(carrierDebt)}
          </p>
        </div>
        <div className="fcard" style={{ flex: 1 }}>
          <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 4px" }}>Поступления</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{money(totalIncome)}</p>
        </div>
        <div className="fcard" style={{ flex: 1 }}>
          <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 4px" }}>Списания</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{money(totalExpense)}</p>
        </div>
        <div className="fcard" style={{ flex: 1 }}>
          <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 4px" }}>Сальдо</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{money(carrierDebt + totalIncome - totalExpense)}</p>
        </div>
      </div>

      {selectedIds.size > 0 && (() => {
        const selEntries = entries.filter((e) => selectedIds.has(e.id));
        const selIncome = selEntries.reduce((s, e) => s + (e.income || 0), 0);
        const selExpense = selEntries.reduce((s, e) => s + (e.expense || 0), 0);
        return (
        <div
          className="fcard"
          style={{
            marginBottom: 16,
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 14 }}>Выбрано операций: <strong>{selectedIds.size}</strong></span>
            {selIncome > 0 && (
              <span style={{ fontSize: 13, color: "var(--good-ink, #27ae60)" }}>
                Поступления: <strong>{money(selIncome)}</strong>
              </span>
            )}
            {selExpense > 0 && (
              <span style={{ fontSize: 13, color: "var(--ember, #e04)" }}>
                Списания: <strong>{money(selExpense)}</strong>
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="pill-btn" onClick={() => setSelectedIds(new Set())}>
              Снять выбор
            </button>
            <button className="pill-btn solid" onClick={openBulkEdit}>
              Изменить выбранные
            </button>
          </div>
        </div>
        );
      })()}

      <div className="fcard">
        {loading ? (
          <p style={{ color: "var(--smoke)" }}>Загрузка...</p>
        ) : entries.length === 0 ? (
          <p style={{ color: "var(--smoke)" }}>Пока нет операций. Добавьте первую операцию вручную.</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: "var(--smoke)" }}>Нет операций, соответствующих текущим фильтрам.</p>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>
                      <input type="checkbox" checked={allPagedSelected} onChange={toggleSelectAllPaged} />
                    </th>
                    <th></th>
                    <Th label="Дата" sortKeyName="date" />
                    <Th label="Статус" sortKeyName="status" />
                    <Th label="Поступления" sortKeyName="income" />
                    <Th label="Списания" sortKeyName="expense" />
                    <Th label="Банк" sortKeyName="bank" />
                    <Th label="Период" sortKeyName="period" />
                    <Th label="НДС %" sortKeyName="vat_pct" />
                    <Th label="НДС факт" sortKeyName="vat_amount" />
                    <Th label="Машина" sortKeyName="truck" />
                    <Th label="Водитель" sortKeyName="driver" />
                    <Th label="Статья" sortKeyName="category" />
                    <Th label="Контрагент" sortKeyName="counterparty" />
                    <Th label="Назначение" sortKeyName="purpose" />
                    <Th label="Кто внёс" sortKeyName="created_by_username" />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((e) => (
                    <tr key={e.id} style={{ cursor: "pointer" }} onClick={() => openEdit(e)}>
                      <td onClick={(ev) => ev.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleSelect(e.id)} />
                      </td>
                      <td onClick={(ev) => ev.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                        <button title="Копировать" style={iconBtnStyle} onClick={() => openCopy(e)}>
                          ⧉
                        </button>
                        <button title="Редактировать" style={{ ...iconBtnStyle, color: "var(--iris)" }} onClick={() => openEdit(e)}>
                          ✎
                        </button>
                        <button
                          title="Удалить"
                          style={{ ...iconBtnStyle, color: "var(--ember)" }}
                          onClick={() => handleDeleteRow(e.id)}
                        >
                          ✕
                        </button>
                      </td>
                      <td>{fmtDate(e.date)}</td>
                      <td>{e.status || "—"}</td>
                      <td>{e.income ? money(e.income) : "—"}</td>
                      <td>{e.expense ? money(e.expense) : "—"}</td>
                      <td>{e.bank || "—"}</td>
                      <td>{e.period || "—"}</td>
                      <td>{e.vat_pct ? `${e.vat_pct}%` : "—"}</td>
                      <td>{e.vat_amount ? money(e.vat_amount) : "—"}</td>
                      <td>{truckLabel(e)}</td>
                      <td>{driverLabel(e)}</td>
                      <td>{e.category || "—"}</td>
                      <td>{e.counterparty || "—"}</td>
                      <td>{e.purpose || "—"}</td>
                      <td style={{ whiteSpace: "nowrap", color: "var(--smoke)", fontSize: 12 }}>
                        {e.created_by_username
                          ? (e.purpose?.startsWith("Компенсация")
                            ? `✓ ${e.created_by_username}`
                            : e.created_by_username)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
              <span style={{ fontSize: 13, color: "var(--smoke)" }}>
                Страница {pageClamped} из {totalPages} ({sorted.length} операций)
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="pill-btn" disabled={pageClamped <= 1} onClick={() => setPage(pageClamped - 1)}>
                  Назад
                </button>
                <button className="pill-btn" disabled={pageClamped >= totalPages} onClick={() => setPage(pageClamped + 1)}>
                  Далее
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {modalOpen && (
        <div className="modal-overlay">
          <div className="fcard" style={{ width: 640, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto" }}>
            <h2 style={{ fontSize: 18, margin: "0 0 16px" }}>{editingId ? "Редактирование операции" : "Новая операция"}</h2>

            <Row>
              <TextField label="Дата" type="date" value={form.date} onChange={handleDateChange} />
              <SelectField label="Статус" value={form.status} onChange={(v) => setField("status", v)} options={STATUSES} />
            </Row>

            <Row>
              <TextField label="Поступления" type="number" value={form.income} onChange={(v) => setField("income", v)} />
              <TextField label="Списания" type="number" value={form.expense} onChange={(v) => setField("expense", v)} />
            </Row>

            <Row>
              <SelectField
                label="Банк"
                value={form.bank}
                onChange={(v) => setField("bank", v)}
                options={BANKS}
                placeholder="Выберите банк"
              />
              <TextField label="Период" value={form.period} onChange={(v) => setField("period", v)} />
              <TextField label="НДС, %" type="number" value={form.vat_pct} onChange={(v) => setField("vat_pct", v)} />
            </Row>

            <Row>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label className="label">Машина</label>
                <select
                  className="input"
                  value={form.truck_id}
                  onChange={(e) => setField("truck_id", e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">Не выбрано</option>
                  {trucks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label className="label">Водитель</label>
                <select
                  className="input"
                  value={form.driver_id}
                  onChange={(e) => setField("driver_id", e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">Не выбрано</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {driverFullName(d)}
                    </option>
                  ))}
                </select>
              </div>
            </Row>

            <Row>
              <SelectField
                label="Статья"
                value={form.category}
                onChange={(v) => setField("category", v)}
                options={categories}
                placeholder="Выберите статью"
              />
            </Row>

            <Row>
              <CounterpartyCombobox
                counterparties={counterparties}
                value={form.counterparty}
                onChange={(name) => setField("counterparty", name)}
                onVatChange={(v) => setField("vat_pct", v)}
                onCounterpartyCreated={(cp) => setCounterparties((prev) => [...prev, cp])}
              />
            </Row>

            <Row>
              <TextAreaField label="Назначение" value={form.purpose} onChange={(v) => setField("purpose", v)} />
            </Row>

            {formError && <p style={{ color: "var(--ember)", fontSize: 13, margin: "0 0 12px" }}>{formError}</p>}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                {editingId && (
                  <button
                    type="button"
                    className="pill-btn"
                    style={{ color: "var(--ember)" }}
                    disabled={saving}
                    onClick={handleDeleteFromModal}
                  >
                    Удалить
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" className="pill-btn" onClick={closeModal}>
                  Отмена
                </button>
                <button type="button" className="pill-btn solid" disabled={saving} onClick={handleSave}>
                  {saving ? "Сохранение..." : "Сохранить"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {bulkModalOpen && (
        <div className="modal-overlay">
          <div className="fcard" style={{ width: 480, maxWidth: "94vw" }}>
            <h2 style={{ fontSize: 18, margin: "0 0 6px" }}>Изменить выбранные операции</h2>
            <p style={{ fontSize: 13, color: "var(--smoke)", margin: "0 0 16px" }}>
              Будут изменены только отмеченные ниже поля у {selectedIds.size} операций.
            </p>

            <BulkRow
              label="Банк"
              enabled={bulkForm.bank.enabled}
              onToggle={(v) => setBulkForm((f) => ({ ...f, bank: { ...f.bank, enabled: v } }))}
            >
              <select
                className="input"
                disabled={!bulkForm.bank.enabled}
                value={bulkForm.bank.value}
                onChange={(e) => setBulkForm((f) => ({ ...f, bank: { ...f.bank, value: e.target.value } }))}
              >
                <option value="">Не выбрано</option>
                {BANKS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </BulkRow>

            <BulkRow
              label="Период"
              enabled={bulkForm.period.enabled}
              onToggle={(v) => setBulkForm((f) => ({ ...f, period: { ...f.period, enabled: v } }))}
            >
              <input
                type="text"
                className="input"
                placeholder="06-2026"
                disabled={!bulkForm.period.enabled}
                value={bulkForm.period.value}
                onChange={(e) => setBulkForm((f) => ({ ...f, period: { ...f.period, value: e.target.value } }))}
              />
            </BulkRow>

            <BulkRow
              label="Машина"
              enabled={bulkForm.truck_id.enabled}
              onToggle={(v) => setBulkForm((f) => ({ ...f, truck_id: { ...f.truck_id, enabled: v } }))}
            >
              <select
                className="input"
                disabled={!bulkForm.truck_id.enabled}
                value={bulkForm.truck_id.value}
                onChange={(e) =>
                  setBulkForm((f) => ({
                    ...f,
                    truck_id: { ...f.truck_id, value: e.target.value ? Number(e.target.value) : "" },
                  }))
                }
              >
                <option value="">Не выбрано</option>
                {trucks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </BulkRow>

            <BulkRow
              label="Водитель"
              enabled={bulkForm.driver_id.enabled}
              onToggle={(v) => setBulkForm((f) => ({ ...f, driver_id: { ...f.driver_id, enabled: v } }))}
            >
              <select
                className="input"
                disabled={!bulkForm.driver_id.enabled}
                value={bulkForm.driver_id.value}
                onChange={(e) =>
                  setBulkForm((f) => ({
                    ...f,
                    driver_id: { ...f.driver_id, value: e.target.value ? Number(e.target.value) : "" },
                  }))
                }
              >
                <option value="">Не выбрано</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {driverFullName(d)}
                  </option>
                ))}
              </select>
            </BulkRow>

            <BulkRow
              label="Статья"
              enabled={bulkForm.category.enabled}
              onToggle={(v) => setBulkForm((f) => ({ ...f, category: { ...f.category, enabled: v } }))}
            >
              <select
                className="input"
                disabled={!bulkForm.category.enabled}
                value={bulkForm.category.value}
                onChange={(e) => setBulkForm((f) => ({ ...f, category: { ...f.category, value: e.target.value } }))}
              >
                <option value="">Не выбрано</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </BulkRow>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
              <button type="button" className="pill-btn" onClick={() => setBulkModalOpen(false)}>
                Отмена
              </button>
              <button type="button" className="pill-btn solid" disabled={bulkSaving} onClick={handleBulkSave}>
                {bulkSaving ? "Сохранение..." : "Применить"}
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
      </div>{/* /tab-panel */}
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>{children}</div>;
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 160 }}>
      <label className="label">{label}</label>
      <input type={type} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ flex: 1 }}>
      <label className="label">{label}</label>
      <textarea
        className="input"
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ resize: "vertical" }}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 160 }}>
      <label className="label">{label}</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function BulkRow({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <label className="checkbox-row" style={{ width: 110, flexShrink: 0 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        {label}
      </label>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
