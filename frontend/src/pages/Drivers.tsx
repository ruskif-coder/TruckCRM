import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError } from "../api";
import AdvanceModal from "../components/AdvanceModal";
import BonusModal from "../components/BonusModal";
import FineModal from "../components/FineModal";
import PayoutModal from "../components/PayoutModal";
import Icon from "../components/Icon";
import { useAuth } from "../auth/AuthContext";
import { money } from "../lib/format";

// Mirrors the legacy desktop app's "Регистрация водителя" form (the user
// supplied a screenshot of it) — same field set/grouping, restyled with
// this app's dark/pill design system instead of the old light-blue look.
// Existing drivers (auto-created by the trip/fuel importers, see
// importers/common.py::find_or_create_driver) only ever had `name`+`phone`
// populated; every other field here is genuinely new and starts blank for
// them, except last_name/first_name which the backend backfills from the
// existing `name` on boot (see database.py::_backfill_driver_names).
type Driver = {
  id: number;
  name: string;
  phone: string;
  notes: string;
  active: boolean;
  mobile_app_enabled: boolean;
  mobile_login: string;
  mobile_password: string;
  last_name: string;
  first_name: string;
  middle_name: string;
  birth_date: string | null;
  birth_place: string;
  email: string;
  passport_number: string;
  passport_issued_date: string | null;
  passport_issued_by: string;
  registration_address: string;
  residence_address: string;
  license_number: string;
  license_issued_date: string | null;
  license_valid_until: string | null;
  skzi_card_number: string;
  skzi_issued_date: string | null;
  skzi_valid_until: string | null;
};

// Минимальный набор полей поездки, нужный только для счётчиков "рейсов
// всего" / "рейсов за неделю" в строке водителя (см. models.Trip на бэке).
// "Отменено" не считаем рейсом, как и тег-цвет в Trips.tsx уже выделяет
// этот статус особо.
type Trip = {
  id: number;
  driver_id: number | null;
  dep_at: string;
  status: string;
};
const TRIP_CANCELLED_STATUS = "Отменено";

// Журнал транзакций водителя (баланс в строке таблицы + модалка выписки)
// LedgerEntry — единый тип для pnl-строк и DriverTransaction
type LedgerEntry = {
  date: string;
  entry_type: string;  // pnl_accrual | pnl_payment | compensation | advance | fine_pdd | fine_company
  amount: number;
  description: string;
};
type DriverBalance = { driver_id: number; balance: number };
const TX_LABELS: Record<string, string> = {
  pnl_accrual: "Начислено",
  pnl_payment: "Выплачено",
  compensation: "Компенсация",
  advance: "Аванс",
  fine_pdd: "Штраф ПДД",
  fine_company: "Штраф от компании",
  payout: "Выплата",
  bonus: "Премия",
};

// Минимальный набор полей перевозчика, нужный только для выбора в форме
// условий оплаты (полная карточка перевозчика — см. Settings.tsx).
type Carrier = { id: number; name: string };

// "Условия оплаты" (2026-06-28, задача "Реальный % водителя") — по запросу
// пользователя ровно в формате "водитель + перевозчик - формат - условие":
// одна строка на пару (водитель, перевозчик), формат из RATE_TYPES на бэке
// (backend/app/models.py), условие — число, единица измерения зависит от
// формата. Заменяет плейсхолдер 30% в calculations.py::weekly_pnl, когда
// для этой пары есть строка.
type DriverRate = {
  id: number;
  driver_id: number;
  carrier_id: number;
  rate_type: string;
  rate_value: number;
  notes: string;
};

const RATE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "percentOfNet", label: "% от чистой выручки" },
  { value: "perTrip", label: "Сумма за рейс" },
  { value: "perKm", label: "Сумма за км" },
  { value: "salary", label: "Оклад (сумма/мес)" },
];

function rateTypeLabel(v: string): string {
  return RATE_TYPE_OPTIONS.find((o) => o.value === v)?.label || v;
}

type RateFormState = {
  carrier_id: string;
  rate_type: string;
  rate_value: string;
  notes: string;
};

const EMPTY_RATE_FORM: RateFormState = { carrier_id: "", rate_type: "percentOfNet", rate_value: "", notes: "" };

type DriverFormState = {
  active: boolean;
  mobile_app_enabled: boolean;
  mobile_login: string;
  mobile_password: string;
  last_name: string;
  first_name: string;
  middle_name: string;
  birth_date: string;
  birth_place: string;
  phone: string;
  email: string;
  passport_number: string;
  passport_issued_date: string;
  passport_issued_by: string;
  registration_address: string;
  residence_address: string;
  license_number: string;
  license_issued_date: string;
  license_valid_until: string;
  skzi_card_number: string;
  skzi_issued_date: string;
  skzi_valid_until: string;
  notes: string;
};

const EMPTY_FORM: DriverFormState = {
  active: true,
  mobile_app_enabled: false,
  mobile_login: "",
  mobile_password: "",
  last_name: "",
  first_name: "",
  middle_name: "",
  birth_date: "",
  birth_place: "",
  phone: "",
  email: "",
  passport_number: "",
  passport_issued_date: "",
  passport_issued_by: "",
  registration_address: "",
  residence_address: "",
  license_number: "",
  license_issued_date: "",
  license_valid_until: "",
  skzi_card_number: "",
  skzi_issued_date: "",
  skzi_valid_until: "",
  notes: "",
};

function driverToForm(d: Driver): DriverFormState {
  return {
    active: d.active,
    mobile_app_enabled: d.mobile_app_enabled,
    mobile_login: d.mobile_login || "",
    mobile_password: d.mobile_password || "",
    last_name: d.last_name || "",
    first_name: d.first_name || "",
    middle_name: d.middle_name || "",
    birth_date: d.birth_date || "",
    birth_place: d.birth_place || "",
    phone: d.phone || "",
    email: d.email || "",
    passport_number: d.passport_number || "",
    passport_issued_date: d.passport_issued_date || "",
    passport_issued_by: d.passport_issued_by || "",
    registration_address: d.registration_address || "",
    residence_address: d.residence_address || "",
    license_number: d.license_number || "",
    license_issued_date: d.license_issued_date || "",
    license_valid_until: d.license_valid_until || "",
    skzi_card_number: d.skzi_card_number || "",
    skzi_issued_date: d.skzi_issued_date || "",
    skzi_valid_until: d.skzi_valid_until || "",
    notes: d.notes || "",
  };
}

function toPayload(f: DriverFormState) {
  const dateOrNull = (s: string) => (s ? s : null);
  return {
    ...f,
    birth_date: dateOrNull(f.birth_date),
    passport_issued_date: dateOrNull(f.passport_issued_date),
    license_issued_date: dateOrNull(f.license_issued_date),
    license_valid_until: dateOrNull(f.license_valid_until),
    skzi_issued_date: dateOrNull(f.skzi_issued_date),
    skzi_valid_until: dateOrNull(f.skzi_valid_until),
  };
}

function fullName(d: Driver): string {
  const parts = [d.last_name, d.first_name, d.middle_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : d.name || "—";
}

// «Создать аккаунт» (2026-06-28, план "кабинет водителя", п.2) - минимальный
// тип ответа POST /api/drivers/{id}/create-account (backend/app/routers/
// drivers.py) - логин+пароль показываются один раз во всплывающей модалке
// и больше нигде не хранятся на фронте (ни в state после закрытия, ни в
// localStorage).
type AccountResult = { username: string; password: string; reset: boolean };

export default function Drivers({ tabsNav }: { tabsNav?: ReactNode } = {}) {
  const { user: me } = useAuth();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  // driver_id → роль пользователя ("driver" | "foreman" | ...). Грузится
  // из /api/foreman-dashboard/drivers — доступно admin и foreman, молчит для остальных.
  const [roleMap, setRoleMap] = useState<Record<number, string>>({});
  const [trips, setTrips] = useState<Trip[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Множество driver_id, у которых уже есть учётка (role=driver) - только
  // для отображения "Сбросить пароль" вместо "Создать аккаунт"; грузится из
  // /api/users/ только для admin, потому что этот эндпоинт сам admin-only
  // (см. routers/users.py) - не-админ получил бы здесь 403 и сломал бы
  // загрузку всей страницы.
  const [driverAccountIds, setDriverAccountIds] = useState<Set<number>>(new Set());
  const [accountBusyId, setAccountBusyId] = useState<number | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountResult, setAccountResult] = useState<AccountResult | null>(null);

  // Балансы водителей (баланс в строке таблицы)
  const [balanceMap, setBalanceMap] = useState<Record<number, number>>({});
  // Модалка выписки по балансу конкретного водителя
  const [ledgerDriver, setLedgerDriver] = useState<Driver | null>(null);
  const [ledgerTxs, setLedgerTxs] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  // Модалка «Выписать штраф»
  const [fineDriver, setFineDriver] = useState<Driver | null>(null);
  // Модалка «Выдать аванс»
  const [advanceDriver, setAdvanceDriver] = useState<Driver | null>(null);
  // Модалка «Начислить премию»
  const [bonusDriver, setBonusDriver] = useState<Driver | null>(null);
  // Модалка «Выплатить водителю»
  const [payoutDriver, setPayoutDriver] = useState<Driver | null>(null);
  // Сортировка по балансу: null = по имени, "desc" = высокий баланс сверху, "asc" = низкий (долг)
  const [balanceSort, setBalanceSort] = useState<"desc" | "asc" | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<DriverFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // "Условия оплаты" — список существующих строк для текущего водителя в
  // модалке (только при редактировании — для нового водителя driver_id ещё
  // не существует, см. форму ниже) и мини-форма добавления/редактирования
  // одной строки.
  const [rates, setRates] = useState<DriverRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [rateForm, setRateForm] = useState<RateFormState>(EMPTY_RATE_FORM);
  const [editingRateId, setEditingRateId] = useState<number | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateSaving, setRateSaving] = useState(false);

  async function loadBalances() {
    try {
      const data = await api.get<DriverBalance[]>("/api/driver-transactions/balances");
      setBalanceMap(Object.fromEntries(data.map((b) => [b.driver_id, b.balance])));
    } catch {
      // Тихо игнорируем — балансы вспомогательные
    }
  }

  async function openLedger(d: Driver) {
    setLedgerDriver(d);
    setLedgerTxs([]);
    setLedgerLoading(true);
    try {
      const data = await api.get<LedgerEntry[]>(
        `/api/driver-transactions/full-ledger?driver_id=${d.id}`
      );
      setLedgerTxs(data);
    } catch { /* ignore */ } finally {
      setLedgerLoading(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [d, t, c] = await Promise.all([
        api.get<Driver[]>("/api/drivers/"),
        api.get<Trip[]>("/api/trips/"),
        api.get<Carrier[]>("/api/carriers/"),
      ]);
      setDrivers(d);
      setTrips(t);
      setCarriers(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    loadBalances(); // 403 тихо игнорируется внутри функции
    // Подгружаем роли водителей — доступно admin/foreman, 403 для остальных игнорируем
    api.get<{ id: number; role: string }[]>("/api/foreman-dashboard/drivers")
      .then(list => setRoleMap(Object.fromEntries(list.map(d => [d.id, d.role]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (me?.role !== "admin") return;
    api
      .get<{ driver_id: number | null }[]>("/api/users/")
      .then((users) => {
        setDriverAccountIds(new Set(users.map((u) => u.driver_id).filter((id): id is number => id != null)));
      })
      .catch(() => {
        // Тихо игнорируем - это вспомогательное "уже есть аккаунт" состояние
        // кнопки, не критично для остальной страницы при сбое загрузки.
      });
  }, [me?.role]);

  async function loadRates(driverId: number) {
    setRatesLoading(true);
    setRateError(null);
    try {
      const r = await api.get<DriverRate[]>(`/api/driver-rates/?driver_id=${driverId}`);
      setRates(r);
    } catch (err) {
      setRateError(err instanceof ApiError ? err.message : "Ошибка загрузки условий оплаты");
    } finally {
      setRatesLoading(false);
    }
  }

  function resetRateForm() {
    setRateForm(EMPTY_RATE_FORM);
    setEditingRateId(null);
    setRateError(null);
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setRates([]);
    resetRateForm();
    setModalOpen(true);
  }

  function openEdit(d: Driver) {
    setEditingId(d.id);
    setForm(driverToForm(d));
    setFormError(null);
    resetRateForm();
    setModalOpen(true);
    loadRates(d.id);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function carrierName(carrierId: number): string {
    return carriers.find((c) => c.id === carrierId)?.name || `Перевозчик #${carrierId}`;
  }

  function setRateField<K extends keyof RateFormState>(key: K, value: RateFormState[K]) {
    setRateForm((f) => ({ ...f, [key]: value }));
  }

  function editRateRow(r: DriverRate) {
    setEditingRateId(r.id);
    setRateForm({
      carrier_id: String(r.carrier_id),
      rate_type: r.rate_type,
      rate_value: String(r.rate_value),
      notes: r.notes || "",
    });
    setRateError(null);
  }

  async function handleSaveRate() {
    if (!editingId) return;
    if (!rateForm.carrier_id) {
      setRateError("Выберите перевозчика");
      return;
    }
    if (rateForm.rate_value === "" || Number.isNaN(Number(rateForm.rate_value))) {
      setRateError("Укажите условие (число)");
      return;
    }
    setRateSaving(true);
    setRateError(null);
    try {
      const payload = {
        driver_id: editingId,
        carrier_id: Number(rateForm.carrier_id),
        rate_type: rateForm.rate_type,
        rate_value: Number(rateForm.rate_value),
        notes: rateForm.notes,
      };
      if (editingRateId) {
        await api.put(`/api/driver-rates/${editingRateId}`, payload);
      } else {
        await api.post("/api/driver-rates/", payload);
      }
      resetRateForm();
      await loadRates(editingId);
    } catch (err) {
      setRateError(err instanceof ApiError ? err.message : "Ошибка сохранения условия");
    } finally {
      setRateSaving(false);
    }
  }

  async function handleDeleteRate(id: number) {
    if (!editingId) return;
    if (!window.confirm("Удалить это условие оплаты?")) return;
    setRateSaving(true);
    setRateError(null);
    try {
      await api.delete(`/api/driver-rates/${id}`);
      if (editingRateId === id) resetRateForm();
      await loadRates(editingId);
    } catch (err) {
      setRateError(err instanceof ApiError ? err.message : "Ошибка удаления");
    } finally {
      setRateSaving(false);
    }
  }

  function setFieldValue<K extends keyof DriverFormState>(key: K, value: DriverFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setFormError(null);
    try {
      const payload = toPayload(form);
      if (editingId) {
        await api.put(`/api/drivers/${editingId}`, payload);
      } else {
        await api.post("/api/drivers/", payload);
      }
      setModalOpen(false);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingId) return;
    if (!window.confirm("Удалить водителя? Связанные поездки и заправки останутся, но потеряют привязку к водителю.")) return;
    setSaving(true);
    setFormError(null);
    try {
      await api.delete(`/api/drivers/${editingId}`);
      setModalOpen(false);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Ошибка удаления");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateAccount(d: Driver) {
    const hasAccount = driverAccountIds.has(d.id);
    if (hasAccount && !window.confirm(`У водителя «${fullName(d)}» уже есть аккаунт. Сбросить пароль?`)) return;
    setAccountBusyId(d.id);
    setAccountError(null);
    try {
      const result = await api.post<AccountResult>(`/api/drivers/${d.id}/create-account`, {});
      setAccountResult(result);
      setDriverAccountIds((prev) => new Set(prev).add(d.id));
    } catch (err) {
      setAccountError(err instanceof ApiError ? err.message : "Ошибка создания аккаунта");
    } finally {
      setAccountBusyId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter((d) =>
      [fullName(d), d.phone, d.email, d.passport_number, d.license_number].some((v) => (v || "").toLowerCase().includes(q))
    );
  }, [drivers, search]);

  // Карточный список (.drow): по умолчанию по ФИО, при balanceSort — по балансу.
  const sorted = useMemo(() => {
    const base = [...filtered];
    if (balanceSort) {
      base.sort((a, b) => {
        const ba = balanceMap[a.id] ?? 0;
        const bb = balanceMap[b.id] ?? 0;
        return balanceSort === "desc" ? bb - ba : ba - bb;
      });
    } else {
      base.sort((a, b) => fullName(a).localeCompare(fullName(b), "ru"));
    }
    return base;
  }, [filtered, balanceSort, balanceMap]);

  // Итоговые суммы по балансам всех водителей (только загруженные)
  const balanceTotals = useMemo(() => {
    let owedToDrivers = 0;  // компания должна водителям
    let owedByDrivers = 0;  // водители должны компании
    for (const d of drivers) {
      const b = balanceMap[d.id];
      if (b == null) continue;
      if (b > 0) owedToDrivers += b;
      else owedByDrivers += Math.abs(b);
    }
    return {
      owedToDrivers: Math.round(owedToDrivers * 100) / 100,
      owedByDrivers: Math.round(owedByDrivers * 100) / 100,
    };
  }, [drivers, balanceMap]);

  // Границы последней завершённой отчётной недели (пн–вс).
  // Скользящее окно "последние 7 дней" заменено на фиксированную неделю,
  // чтобы показатель "за неделю" не менялся в течение текущей недели.
  const { lastWeekStart, lastWeekEnd, lastWeekLabel } = useMemo(() => {
    const today = new Date();
    const day = today.getDay(); // 0=вс
    const daysToMon = day === 0 ? 6 : day - 1;
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - daysToMon);
    thisMonday.setHours(0, 0, 0, 0);
    const start = new Date(thisMonday);
    start.setDate(thisMonday.getDate() - 7);
    const end = new Date(thisMonday);
    end.setDate(thisMonday.getDate() - 1);
    end.setHours(23, 59, 59, 999);
    const fmt = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { lastWeekStart: start, lastWeekEnd: end, lastWeekLabel: `${fmt(start)}–${fmt(end)}` };
  }, []);

  // Статистика по рейсам для строки водителя: "рейсов всего" и "за прошлую неделю"
  // (пн–вс последней завершённой недели). "Отменено" не считаем рейсом.
  const tripStats = useMemo(() => {
    const stats = new Map<number, { total: number; week: number }>();
    for (const t of trips) {
      if (t.driver_id == null || t.status === TRIP_CANCELLED_STATUS) continue;
      const cur = stats.get(t.driver_id) || { total: 0, week: 0 };
      cur.total += 1;
      const dep = new Date(t.dep_at);
      if (dep >= lastWeekStart && dep <= lastWeekEnd) cur.week += 1;
      stats.set(t.driver_id, cur);
    }
    return stats;
  }, [trips, lastWeekStart, lastWeekEnd]);

  function initials(d: Driver): string {
    const n = fullName(d);
    return n && n !== "—" ? n.charAt(0).toUpperCase() : "?";
  }

  return (
    <div>
      {/* 2026-06-28: собственный pagehead убран - страница теперь живёт как
          вкладка «Водители» внутри Справочники (см. pages/Directories.tsx),
          которая передаёт сюда переключатель вкладок (tabsNav) - рисуем его
          в одной строке с кнопкой действия, не отдельной строкой. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabsNav}
        <button className="pill-btn solid" onClick={openCreate}>
          <Icon name="plus" size={17} /> <span className="lbl-hide">Добавить водителя</span>
        </button>
      </div>

      {error && (
        <p className="fcard" style={{ color: "var(--ember)", marginBottom: 24 }}>
          {error}
        </p>
      )}

      <div className="fcard" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
          <div>
            <label className="label">Поиск</label>
            <input
              type="text"
              className="input"
              placeholder="ФИО, телефон, email, паспорт, права..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: 300 }}
            />
          </div>
          {Object.keys(balanceMap).length > 0 && (
            <div style={{ display: "flex", gap: 20, fontSize: 13, paddingBottom: 2, flexWrap: "wrap" }}>
              <span>
                Компания → водителям:{" "}
                <strong style={{ color: "var(--iris, #6366f1)" }}>
                  {money(balanceTotals.owedToDrivers)}
                </strong>
              </span>
              <span>
                Водители → компании:{" "}
                <strong style={{ color: "var(--ember, #e74c3c)" }}>
                  {money(balanceTotals.owedByDrivers)}
                </strong>
              </span>
              <span>
                Нетто:{" "}
                <strong style={{
                  color: balanceTotals.owedToDrivers - balanceTotals.owedByDrivers >= 0
                    ? "var(--iris, #6366f1)"
                    : "var(--ember, #e74c3c)",
                }}>
                  {money(balanceTotals.owedToDrivers - balanceTotals.owedByDrivers)}
                </strong>
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="fcard" style={{ padding: 0 }}>
        {loading ? (
          <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>Загрузка...</p>
        ) : drivers.length === 0 ? (
          <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>
            Пока нет водителей. Добавьте вручную или импортируйте поездки/заправки.
          </p>
        ) : sorted.length === 0 ? (
          <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>Ничего не найдено.</p>
        ) : (
          // Строка сортировки
          <>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 16px", borderBottom: "1px solid var(--line)",
            background: "var(--bg-sub, rgba(0,0,0,.02))",
          }}>
            <span style={{ fontSize: 12, color: "var(--ink-3)", marginRight: 4 }}>Сортировка:</span>
            <button
              type="button"
              className={`pill-btn${!balanceSort ? " solid" : ""}`}
              style={{ padding: "3px 12px", fontSize: 12 }}
              onClick={() => setBalanceSort(null)}
            >
              По имени
            </button>
            <button
              type="button"
              className={`pill-btn${balanceSort === "desc" ? " solid" : ""}`}
              style={{ padding: "3px 12px", fontSize: 12 }}
              onClick={() => setBalanceSort("desc")}
            >
              Баланс ↓
            </button>
            <button
              type="button"
              className={`pill-btn${balanceSort === "asc" ? " solid" : ""}`}
              style={{ padding: "3px 12px", fontSize: 12 }}
              onClick={() => setBalanceSort("asc")}
            >
              Баланс ↑
            </button>
          </div>
          {/* Карточный список .drow (см. design_handoff_fleet_dashboard) —
              счётчики рейсов считаются по реальным Trip (см. tripStats выше). */}
          {sorted.map((d) => {
            const stats = tripStats.get(d.id) || { total: 0, week: 0 };
            return (
              <div key={d.id} className="drow" onClick={() => openEdit(d)} style={{ cursor: "pointer" }}>
                <div className="dav">{initials(d)}</div>
                {/* Имя + телефон */}
                <div className="dinfo">
                  <div className="dname" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {fullName(d)}
                    {roleMap[d.id] === "foreman" && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "1px 6px",
                        borderRadius: 6, background: "rgba(124,58,237,.12)",
                        color: "#7c3aed", whiteSpace: "nowrap",
                      }}>Бригадир</span>
                    )}
                  </div>
                  <div className="dsub">{d.phone || "телефон не указан"}</div>
                </div>

                {/* Статистика — фиксированные колонки одинаковой высоты */}
                <div style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
                  <div style={{ width: 68, textAlign: "center" }}>
                    <div className="n">{stats.total}</div>
                    <div className="l">всего</div>
                  </div>
                  <div style={{ width: 68, textAlign: "center" }}>
                    <div className="n">{stats.week}</div>
                    <div className="l" title={`пн–вс ${lastWeekLabel}`}>неделя</div>
                  </div>
                  {/* Баланс — кликабелен → выписка */}
                  <div
                    onClick={(e) => { e.stopPropagation(); void openLedger(d); }}
                    style={{ width: 116, textAlign: "center", cursor: "pointer", userSelect: "none" }}
                    title="Нажмите для детализации баланса"
                  >
                    <div className="n" style={{
                      fontSize: "1.1rem", whiteSpace: "nowrap",
                      color: balanceMap[d.id] != null
                        ? balanceMap[d.id] < 0 ? "var(--ember, #e74c3c)" : "var(--iris, #6366f1)"
                        : "var(--ink-3)",
                    }}>
                      {balanceMap[d.id] != null ? money(balanceMap[d.id]) : "—"}
                    </div>
                    <div className="l">баланс ↗</div>
                  </div>
                </div>

                {/* Статус — фиксированная ширина чтобы "Активен" и "Неактивен" одинаковые */}
                <span className={`status ${d.active ? "st-route" : "st-free"}`}
                  style={{ flexShrink: 0, width: 98, justifyContent: "center" }}>
                  <span className="sd" />
                  {d.active ? "Активен" : "Неактивен"}
                </span>

                {/* Иконочные кнопки действий */}
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                  {(me?.role === "admin" || me?.role === "foreman" || me?.role === "accountant") && (<>
                    {/* Штраф */}
                    <button type="button" title="Штраф" className="icon-action-btn" style={{ color: "var(--ember, #e74c3c)" }}
                      onClick={() => setFineDriver(d)}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" width="16" height="16">
                        <path d="M10 3L2 17h16L10 3z" strokeLinejoin="round"/>
                        <path d="M10 8v4M10 14.5v.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                    {/* Аванс */}
                    <button type="button" title="Аванс" className="icon-action-btn"
                      onClick={() => setAdvanceDriver(d)}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" width="16" height="16">
                        <rect x="2" y="5" width="16" height="11" rx="2"/>
                        <path d="M2 8h16M7 12h2" strokeLinecap="round"/>
                      </svg>
                    </button>
                    {/* Премия */}
                    <button type="button" title="Премия" className="icon-action-btn" style={{ color: "#f59e0b" }}
                      onClick={() => setBonusDriver(d)}>
                      <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                        <path d="M10 2l2.09 4.26L17 7.27l-3.5 3.41.83 4.82L10 13.27l-4.33 2.23.83-4.82L3 7.27l4.91-.71L10 2z"/>
                      </svg>
                    </button>
                    {/* Выплата */}
                    <button type="button" title="Выплата" className="icon-action-btn" style={{ color: "var(--good-ink, #27ae60)" }}
                      onClick={() => setPayoutDriver(d)}>
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" width="16" height="16">
                        <path d="M10 14V4M6 8l4-4 4 4" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M4 17h12" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </>)}
                  {me?.role === "admin" && (
                    <button type="button"
                      title={driverAccountIds.has(d.id) ? "Сбросить пароль" : "Создать аккаунт"}
                      className="icon-action-btn"
                      disabled={accountBusyId === d.id}
                      onClick={() => handleCreateAccount(d)}>
                      {accountBusyId === d.id
                        ? <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" width="16" height="16"><circle cx="10" cy="10" r="7" strokeDasharray="4 2"/></svg>
                        : driverAccountIds.has(d.id)
                          ? <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" width="16" height="16"><path d="M4 10.5A5.5 5.5 0 0115.5 6M16 10.5A5.5 5.5 0 014.5 15M12 4l2 2-2 2M8 16l-2-2 2-2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          : <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" width="16" height="16"><circle cx="9" cy="7" r="4"/><path d="M2 17c0-3.3 3.1-6 7-6M15 12v5M12.5 14.5h5" strokeLinecap="round"/></svg>
                      }
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          </>
        )}
      </div>

      {modalOpen && (
        <div className="modal-overlay">
          <div className="fcard" style={{ width: 760, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", padding: 0 }}>
            <div
              style={{
                background: "var(--dark)",
                color: "#fff",
                padding: "16px 24px",
                borderRadius: "26px 26px 0 0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h2 style={{ fontSize: 18, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                {editingId ? "Карточка водителя" : "Регистрация водителя"}
                {editingId && roleMap[editingId] === "foreman" && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "2px 8px",
                    borderRadius: 6, background: "rgba(124,58,237,.25)",
                    color: "#c4b5fd", whiteSpace: "nowrap",
                  }}>👷 Бригадир</span>
                )}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: 24 }}>
              <Row>
                <CheckboxField label="Активен" checked={form.active} onChange={(v) => setFieldValue("active", v)} />
                <CheckboxField
                  label="Моб. приложение"
                  checked={form.mobile_app_enabled}
                  onChange={(v) => setFieldValue("mobile_app_enabled", v)}
                />
              </Row>

              <Row>
                <TextField
                  label="Логин (моб. приложение)"
                  value={form.mobile_login}
                  onChange={(v) => setFieldValue("mobile_login", v)}
                />
                <TextField
                  label="Пароль (моб. приложение)"
                  value={form.mobile_password}
                  onChange={(v) => setFieldValue("mobile_password", v)}
                />
              </Row>

              <Row>
                <TextField label="Фамилия" value={form.last_name} onChange={(v) => setFieldValue("last_name", v)} />
                <TextField label="Имя" value={form.first_name} onChange={(v) => setFieldValue("first_name", v)} />
                <TextField label="Отчество" value={form.middle_name} onChange={(v) => setFieldValue("middle_name", v)} />
              </Row>

              <Row>
                <TextField
                  label="Дата рождения"
                  type="date"
                  value={form.birth_date}
                  onChange={(v) => setFieldValue("birth_date", v)}
                />
                <TextField label="Место рождения" value={form.birth_place} onChange={(v) => setFieldValue("birth_place", v)} />
              </Row>

              <Row>
                <TextField label="Телефон" value={form.phone} onChange={(v) => setFieldValue("phone", v)} />
                <TextField label="Email" type="email" value={form.email} onChange={(v) => setFieldValue("email", v)} />
              </Row>

              <Row>
                <TextField
                  label="Паспорт. Серия, номер"
                  value={form.passport_number}
                  onChange={(v) => setFieldValue("passport_number", v)}
                />
                <TextField
                  label="Паспорт. Дата выдачи"
                  type="date"
                  value={form.passport_issued_date}
                  onChange={(v) => setFieldValue("passport_issued_date", v)}
                />
              </Row>

              <Row>
                <TextField
                  label="Паспорт. Кем выдан"
                  value={form.passport_issued_by}
                  onChange={(v) => setFieldValue("passport_issued_by", v)}
                />
              </Row>

              <Row>
                <TextField
                  label="Адрес регистрации"
                  value={form.registration_address}
                  onChange={(v) => setFieldValue("registration_address", v)}
                />
              </Row>

              <Row>
                <TextField
                  label="Место жительства"
                  value={form.residence_address}
                  onChange={(v) => setFieldValue("residence_address", v)}
                />
              </Row>

              <Row>
                <TextField
                  label="Права. Серия, номер"
                  value={form.license_number}
                  onChange={(v) => setFieldValue("license_number", v)}
                />
                <TextField
                  label="Права. Выданы"
                  type="date"
                  value={form.license_issued_date}
                  onChange={(v) => setFieldValue("license_issued_date", v)}
                />
                <TextField
                  label="Права. Действ. до"
                  type="date"
                  value={form.license_valid_until}
                  onChange={(v) => setFieldValue("license_valid_until", v)}
                />
              </Row>

              <Row>
                <TextField
                  label="Карта СКЗИ. Серия, номер"
                  value={form.skzi_card_number}
                  onChange={(v) => setFieldValue("skzi_card_number", v)}
                />
                <TextField
                  label="Карта СКЗИ. Выдана"
                  type="date"
                  value={form.skzi_issued_date}
                  onChange={(v) => setFieldValue("skzi_issued_date", v)}
                />
                <TextField
                  label="Карта СКЗИ. Действ. до"
                  type="date"
                  value={form.skzi_valid_until}
                  onChange={(v) => setFieldValue("skzi_valid_until", v)}
                />
              </Row>

              <Row>
                <TextAreaField label="Примечание" value={form.notes} onChange={(v) => setFieldValue("notes", v)} />
              </Row>

              {formError && <p style={{ color: "var(--ember)", fontSize: 13, margin: "0 0 12px" }}>{formError}</p>}

              <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16, marginBottom: 16 }}>
                <label className="label">Условия оплаты</label>
                {!editingId ? (
                  <p style={{ color: "var(--ink-3)", fontSize: 13, margin: "4px 0 0" }}>
                    Сохраните карточку водителя, затем добавьте условия оплаты (перевозчик → формат → условие).
                  </p>
                ) : (
                  <>
                    {ratesLoading ? (
                      <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Загрузка...</p>
                    ) : rates.length === 0 ? (
                      <p style={{ color: "var(--ink-3)", fontSize: 13, margin: "4px 0 12px" }}>
                        Условий пока нет — для этого водителя используется временный плейсхолдер 30% от чистой выручки.
                      </p>
                    ) : (
                      <div style={{ marginBottom: 12 }}>
                        {rates.map((r) => (
                          <div
                            key={r.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "8px 0",
                              borderBottom: "1px solid var(--line)",
                              fontSize: 13,
                            }}
                          >
                            <span style={{ flex: 1, fontWeight: 500 }}>{carrierName(r.carrier_id)}</span>
                            <span style={{ flex: 1, color: "var(--ink-3)" }}>{rateTypeLabel(r.rate_type)}</span>
                            <span style={{ width: 90, textAlign: "right" }}>
                              {r.rate_value}
                              {r.rate_type === "percentOfNet" ? "%" : ""}
                            </span>
                            <button type="button" className="pill-btn" style={{ padding: "4px 10px" }} onClick={() => editRateRow(r)}>
                              Изм.
                            </button>
                            <button
                              type="button"
                              className="pill-btn"
                              style={{ padding: "4px 10px", color: "var(--bad-ink)" }}
                              disabled={rateSaving}
                              onClick={() => handleDeleteRate(r.id)}
                            >
                              Удал.
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <Row>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">Перевозчик</label>
                        <select
                          className="input"
                          value={rateForm.carrier_id}
                          onChange={(e) => setRateField("carrier_id", e.target.value)}
                        >
                          <option value="">— выберите —</option>
                          {carriers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <label className="label">Формат</label>
                        <select
                          className="input"
                          value={rateForm.rate_type}
                          onChange={(e) => setRateField("rate_type", e.target.value)}
                        >
                          {RATE_TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <label className="label">Условие</label>
                        <input
                          type="number"
                          className="input"
                          value={rateForm.rate_value}
                          onChange={(e) => setRateField("rate_value", e.target.value)}
                        />
                      </div>
                    </Row>
                    <Row>
                      <TextField label="Примечание" value={rateForm.notes} onChange={(v) => setRateField("notes", v)} />
                    </Row>

                    {rateError && <p style={{ color: "var(--ember)", fontSize: 13, margin: "0 0 8px" }}>{rateError}</p>}

                    <div style={{ display: "flex", gap: 10 }}>
                      <button type="button" className="pill-btn solid" disabled={rateSaving} onClick={handleSaveRate}>
                        {rateSaving ? "Сохранение..." : editingRateId ? "Сохранить условие" : "Добавить условие"}
                      </button>
                      {editingRateId && (
                        <button type="button" className="pill-btn" onClick={resetRateForm}>
                          Отмена
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  {editingId && (
                    <button
                      type="button"
                      className="pill-btn"
                      style={{ color: "var(--bad-ink)" }}
                      disabled={saving}
                      onClick={handleDelete}
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
        </div>
      )}

      {/* Модалка: выписка по балансу водителя */}
      {ledgerDriver && (
        <div className="modal-overlay">
          <div
            className="fcard"
            style={{ width: 660, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", padding: 0 }}
          >
            {/* Шапка */}
            <div
              style={{
                background: "var(--dark)",
                color: "#fff",
                padding: "16px 24px",
                borderRadius: "26px 26px 0 0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <div>
                <h2 style={{ fontSize: 18, margin: 0 }}>{fullName(ledgerDriver)}</h2>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,.6)", marginTop: 4 }}>
                  Выписка по балансу
                  {balanceMap[ledgerDriver.id] != null && (
                    <span
                      style={{
                        marginLeft: 12,
                        fontWeight: 700,
                        color: balanceMap[ledgerDriver.id] < 0 ? "#f87171" : "#a5b4fc",
                      }}
                    >
                      Итого: {money(balanceMap[ledgerDriver.id])}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className="pill-btn"
                  style={{ color: "#fff", background: "rgba(255,255,255,.15)", borderColor: "rgba(255,255,255,.3)" }}
                  onClick={() => {
                    const d = ledgerDriver;
                    setLedgerDriver(null);
                    setFineDriver(d);
                  }}
                >
                  Выписать штраф
                </button>
                <button
                  type="button"
                  className="pill-btn"
                  style={{ color: "#fff", background: "rgba(255,255,255,.15)", borderColor: "rgba(255,255,255,.3)" }}
                  onClick={() => {
                    const d = ledgerDriver;
                    setLedgerDriver(null);
                    setAdvanceDriver(d);
                  }}
                >
                  Аванс
                </button>
                <button
                  type="button"
                  className="pill-btn"
                  style={{ color: "#fff", background: "rgba(255,255,255,.15)", borderColor: "rgba(255,255,255,.3)" }}
                  onClick={() => {
                    const d = ledgerDriver;
                    setLedgerDriver(null);
                    setPayoutDriver(d);
                  }}
                >
                  Выплата
                </button>
                <button
                  type="button"
                  onClick={() => setLedgerDriver(null)}
                  style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
            </div>

            {/* Тело */}
            <div style={{ padding: 24 }}>
              {ledgerLoading ? (
                <p style={{ color: "var(--ink-3)" }}>Загрузка...</p>
              ) : ledgerTxs.length === 0 ? (
                <p style={{ color: "var(--ink-3)" }}>
                  Корректировок баланса ещё нет. Баланс формируется из расчётов по рейсам.
                </p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      {["Дата", "Операция", "Сумма", "Комментарий"].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            padding: "6px 8px",
                            borderBottom: "1px solid var(--line)",
                            color: "var(--ink-3)",
                            fontWeight: 500,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerTxs.map((tx, i) => {
                      const isPnl = tx.entry_type === "pnl_accrual" || tx.entry_type === "pnl_payment";
                      return (
                        <tr
                          key={i}
                          style={isPnl ? { background: "rgba(99,102,241,.04)" } : undefined}
                        >
                          <td style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>
                            {tx.date?.slice(0, 10)}
                          </td>
                          <td style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)" }}>
                            {TX_LABELS[tx.entry_type] ?? tx.entry_type}
                          </td>
                          <td
                            style={{
                              padding: "8px 8px",
                              borderBottom: "1px solid var(--line)",
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                              color: tx.amount >= 0 ? "var(--good, #22c55e)" : "var(--ember, #e74c3c)",
                            }}
                          >
                            {tx.amount >= 0 ? "+" : ""}
                            {money(tx.amount)}
                          </td>
                          <td style={{ padding: "8px 8px", borderBottom: "1px solid var(--line)", color: "var(--ink-3)" }}>
                            {tx.description || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Модалка: выписать штраф */}
      {fineDriver && (
        <FineModal
          drivers={drivers}
          defaultDriverId={fineDriver.id}
          onClose={() => setFineDriver(null)}
          onSaved={(did) => {
            setFineDriver(null);
            void loadBalances();
            if (ledgerDriver?.id === did) {
              void openLedger(ledgerDriver);
            }
          }}
        />
      )}

      {/* Модалка: выдать аванс */}
      {advanceDriver && (
        <AdvanceModal
          drivers={drivers}
          defaultDriverId={advanceDriver.id}
          onClose={() => setAdvanceDriver(null)}
          onSaved={(did) => {
            setAdvanceDriver(null);
            void loadBalances();
            if (ledgerDriver?.id === did) {
              void openLedger(ledgerDriver);
            }
          }}
        />
      )}

      {/* Модалка: начислить премию */}
      {bonusDriver && (
        <BonusModal
          drivers={drivers}
          defaultDriverId={bonusDriver.id}
          onClose={() => setBonusDriver(null)}
          onSaved={(did) => {
            setBonusDriver(null);
            void loadBalances();
            if (ledgerDriver?.id === did) {
              void openLedger(ledgerDriver);
            }
          }}
        />
      )}

      {/* Модалка: выплатить водителю */}
      {payoutDriver && (
        <PayoutModal
          drivers={drivers}
          defaultDriverId={payoutDriver.id}
          defaultAmount={Math.max(0, balanceMap[payoutDriver.id] ?? 0)}
          onClose={() => setPayoutDriver(null)}
          onSaved={(did) => {
            setPayoutDriver(null);
            void loadBalances();
            if (ledgerDriver?.id === did) {
              void openLedger(ledgerDriver);
            }
          }}
        />
      )}

      {accountError && !accountResult && (
        <div className="modal-overlay" onClick={() => setAccountError(null)}>
          <div className="fcard" style={{ width: 420, maxWidth: "94vw" }} onClick={(e) => e.stopPropagation()}>
            <p style={{ color: "var(--ember)", marginBottom: 16 }}>{accountError}</p>
            <button type="button" className="pill-btn solid" onClick={() => setAccountError(null)}>
              Закрыть
            </button>
          </div>
        </div>
      )}

      {accountResult && (
        <div className="modal-overlay">
          <div className="fcard" style={{ width: 420, maxWidth: "94vw", padding: 0 }}>
            <div
              style={{
                background: "var(--dark)",
                color: "#fff",
                padding: "16px 24px",
                borderRadius: "26px 26px 0 0",
              }}
            >
              <h2 style={{ fontSize: 18, margin: 0 }}>
                {accountResult.reset ? "Пароль сброшен" : "Аккаунт создан"}
              </h2>
            </div>
            <div style={{ padding: 24 }}>
              <p style={{ color: "var(--ink-3)", fontSize: 13, marginBottom: 16 }}>
                Пароль показывается только сейчас — сохраните его и передайте водителю, повторно увидеть его будет
                нельзя (на сервере хранится только хэш).
              </p>
              <Row>
                <TextField label="Логин" value={accountResult.username} onChange={() => {}} />
                <TextField label="Пароль" value={accountResult.password} onChange={() => {}} />
              </Row>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="pill-btn solid" onClick={() => setAccountResult(null)}>
                  Готово
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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

function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox-row" style={{ flex: 1 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
