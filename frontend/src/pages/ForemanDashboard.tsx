/**
 * Мобильный дашборд бригадира (2026-07-04).
 * Структура: фиксированный хедер + нижняя навигация из 5 разделов.
 * Доступен только пользователям с ролью foreman (и admin).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";

// ─── Типы ─────────────────────────────────────────────────────────────────────
type FTruck = {
  id: number; plate: string; label: string; brand: string;
  year: number | null; vehicle_type: string; body_type: string;
  maintenance_interval_km: number | null;
  vin: string; chassis_number: string; pts_number: string;
  sts_number: string; sts_date: string | null;
  osago_date: string | null; osago_number: string;
  tech_inspection_date: string | null; tech_inspection_number: string;
  kasko_date: string | null; kasko_number: string;
  notes: string;
};
type FullDriverDetail = {
  id: number; last_name: string; first_name: string; middle_name: string;
  birth_date: string | null; phone: string; email: string;
  license_number: string; license_issued_date: string | null; license_valid_until: string | null;
  skzi_card_number: string; skzi_issued_date: string | null; skzi_valid_until: string | null;
  notes: string; active: boolean;
};
type FDriver = {
  id: number; name: string; phone: string; email: string;
  active: boolean; truck_id: number | null; truck_plate: string | null;
  role: string;
};
type FRepair = {
  id: number; driver_id: number | null; truck_id: number | null;
  text: string; status: string; priority: string;
  created_at: string; close_comment: string;
  driver_name: string; truck_label: string;
};
type FComp = {
  id: number; driver_id: number | null; truck_id: number | null;
  expense_date: string; amount: number; category: string;
  description: string; status: string; reject_reason: string;
  created_at: string; driver_name: string; truck_label: string;
};
type FTrip = {
  id: number; dep_at: string; end_at: string | null;
  source: string; request_number: string; external_request_number: string;
  tariff_type: string; status: string; amount: number; fines: number;
  driver_id: number | null; truck_id: number | null;
  driver_name_raw: string; driver_phone: string; carrier_name: string;
};
type FMileage = {
  id: number; date: string; truck_id: number; driver_id: number | null;
  odometer: number | null; is_service: boolean; note: string;
};
type FExpense = {
  id: number; date: string; status: string;
  expense: number; income: number; bank: string;
  category: string; purpose: string;
  truck_id: number | null; created_by_user_id: number | null;
};
type AttentionData = {
  expiring_docs: {
    truck_id: number; plate: string; label: string;
    doc_type: string; expiry_date: string; days_left: number; critical: boolean;
  }[];
  urgent_repairs: {
    id: number; driver_name: string; truck_label: string;
    text: string; priority: string; created_at: string;
  }[];
  open_repairs_count: number;
  pending_comps_count: number;
};

type FActiveSession = {
  session_id: number; truck_id: number; driver_id: number;
  driver_name: string; started_at: string;
};
type FleetSessInspItem = { id: number; block: number; label: string; status: string; note: string; item_count: number | null };
type FleetSessInspDetail = {
  id: number; kind: string; odometer: number | null; created_at: string;
  items: FleetSessInspItem[];
  damages: { id: number; description: string; photo_path: string }[];
};
type FleetSessDetail = {
  id: number; driver_name: string; truck_plate: string; truck_label: string;
  started_at: string; ended_at: string | null;
  start_inspection: FleetSessInspDetail | null;
  end_inspection: FleetSessInspDetail | null;
};

// ─── Цвета ────────────────────────────────────────────────────────────────────
// 2026-07-07: приведено к единой теме приложения. Кастомный фиолетовый
// (#7c3aed) заменён на стандартный акцент --iris (#5683da). Нейтральные
// поверхности используют CSS-переменные — дашборд автоматически подхватит
// светлую/тёмную тему, если она будет добавлена.
const C = {
  bg:        "var(--canvas)",
  card:      "var(--card)",
  border:    "var(--edge)",
  ink:       "var(--ash, #4b4c52)",
  ink2:      "var(--smoke, #8a8b90)",
  iris:      "var(--iris, #5683da)",
  irisLight: "rgba(86,131,218,.10)",
  good:      "#27ae60",
  warn:      "#d99a3a",
  danger:    "#e74c3c",
  foreman:   "var(--iris, #5683da)",   // ранее #7c3aed — приведено к стандарту
  foremanL:  "rgba(86,131,218,.12)",   // ранее rgba(124,58,237,.12)
  radius:    16,
};

// ─── Вспомогательные ──────────────────────────────────────────────────────────
function money(n: number) {
  return n.toLocaleString("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" })
    + " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
}
function docColor(days: number | null): string {
  if (days === null) return C.ink2;
  if (days < 0) return C.danger;
  if (days <= 7) return C.danger;
  if (days <= 30) return C.warn;
  return C.good;
}

/**
 * Последний одометр + пробег с ТО + остаток до ТО для машины.
 * Цвет: < 15 000 км с ТО → зелёный, 15 000–17 000 → жёлтый, ≥ 17 000 → красный.
 */
function getTruckToStats(
  truckId: number,
  maintenanceIntervalKm: number | null,
  mileages: FMileage[],
): { lastOdometer: number; kmSince: number | null; remaining: number | null } | null {
  const entries = mileages
    .filter(m => m.truck_id === truckId && m.odometer != null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  if (entries.length === 0) return null;
  const lastOdometer = entries[0].odometer!;
  if (!maintenanceIntervalKm) return { lastOdometer, kmSince: null, remaining: null };
  const lastService = entries.find(m => m.is_service && m.odometer != null);
  if (!lastService) return { lastOdometer, kmSince: null, remaining: null };
  const kmSince = Math.max(0, lastOdometer - lastService.odometer!);
  return { lastOdometer, kmSince, remaining: maintenanceIntervalKm - kmSince };
}

function toKmColor(kmSince: number): string {
  if (kmSince >= 17000) return C.danger;
  if (kmSince >= 15000) return C.warn;
  return C.good;
}

// Маленький цветной бейдж
function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 7px", borderRadius: 8,
      fontSize: 11, fontWeight: 700, color, background: bg, whiteSpace: "nowrap",
    }}>
      {text}
    </span>
  );
}

// Бейдж роли водителя
function RoleBadge({ role }: { role: string }) {
  if (role === "foreman") {
    return <Badge text="Бригадир" color={C.foreman} bg={C.foremanL} />;
  }
  return <Badge text="Водитель" color={C.ink2} bg={C.border} />;
}

// Кнопка-карточка действия
function ActionBtn({ icon, label, onClick, accent }: {
  icon: string; label: string; onClick: () => void; accent?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} style={{
      background: accent ? C.foreman : C.card,
      color: accent ? "#fff" : C.ink,
      border: "none", borderRadius: C.radius, padding: "14px 12px",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
      boxShadow: "0 2px 10px rgba(0,0,0,.07)", width: "100%",
    }}>
      <span style={{ fontSize: 22 }}>{icon}</span>
      {label}
    </button>
  );
}

// Модальное окно
function Modal({ title, onClose, children, onSubmit, saving, error, submitLabel }: {
  title: string; onClose: () => void; children: ReactNode;
  onSubmit?: () => void; saving?: boolean; error?: string | null; submitLabel?: string;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      zIndex: 200, padding: "0 0 env(safe-area-inset-bottom,0)",
    }}>
      <div style={{
        background: C.card, borderRadius: "20px 20px 0 0",
        width: "100%", maxWidth: 520, maxHeight: "88vh",
        overflow: "auto", padding: "20px 18px 28px",
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <span style={{ flex: 1, fontWeight: 700, fontSize: 16, color: C.ink }}>{title}</span>
          <button type="button" onClick={onClose} style={{
            background: "none", border: "none", fontSize: 22, color: C.ink2,
            cursor: "pointer", lineHeight: 1, padding: "0 4px",
          }}>✕</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {children}
        </div>
        {error && <p style={{ color: C.danger, fontSize: 12, marginTop: 8 }}>{error}</p>}
        {onSubmit && (
          <button type="button" onClick={onSubmit} disabled={saving} style={{
            marginTop: 16, width: "100%", background: C.foreman, color: "#fff",
            border: "none", borderRadius: 12, padding: "14px 0", fontSize: 15,
            fontWeight: 700, fontFamily: "inherit", cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}>
            {saving ? "Сохраняем..." : (submitLabel ?? "Сохранить")}
          </button>
        )}
      </div>
    </div>
  );
}

// Инпут для модалки
const inputSt: CSSProperties = {
  width: "100%", padding: "11px 13px", border: `1px solid ${C.border}`,
  borderRadius: 10, fontSize: 14, fontFamily: "inherit", background: C.bg,
  color: C.ink, boxSizing: "border-box",
};

// Секция-карточка
function SCard({ children, style, onClick }: { children: ReactNode; style?: CSSProperties; onClick?: () => void }) {
  return (
    <div style={{
      background: C.card, borderRadius: C.radius, padding: "14px 16px",
      boxShadow: "0 2px 10px rgba(0,0,0,.06)", ...style,
    }} onClick={onClick}>
      {children}
    </div>
  );
}

// Мини-строка label + value для раскрытых деталей
function DetailRow({
  label, value, valueStyle,
}: { label: string; value: string; valueStyle?: CSSProperties }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.ink2, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: C.ink, fontWeight: 500, ...valueStyle }}>
        {value}
      </div>
    </div>
  );
}

// ─── Главный компонент ────────────────────────────────────────────────────────
type Section = "home" | "fleet" | "team" | "trips" | "requests";
type Modal_ = "repair" | "mileage" | null;
type RepairStatus = "создана" | "в работе" | "закрыта";

const STATUS_COLORS: Record<string, string> = {
  "создана":    C.warn,
  "в работе":  "#3b82f6",
  "закрыта":   C.ink2,
};

export default function ForemanDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [section, setSection] = useState<Section>("home");
  const [tripsTab, setTripsTab] = useState<"list" | "mileage">("list");
  const [reqTab, setReqTab] = useState<"repairs" | "comps">("repairs");

  // ─ Данные ─
  const [attention, setAttention] = useState<AttentionData | null>(null);
  const [trucks, setTrucks] = useState<FTruck[]>([]);
  const [drivers, setDrivers] = useState<FDriver[]>([]);
  const [repairs, setRepairs] = useState<FRepair[]>([]);
  const [comps, setComps] = useState<FComp[]>([]);
  const [trips, setTrips] = useState<FTrip[]>([]);
  const [mileages, setMileages] = useState<FMileage[]>([]);
  const [expCats, setExpCats] = useState<string[]>([]);
  const [myExpenses, setMyExpenses] = useState<FExpense[]>([]);
  const [loading, setLoading] = useState(true);

  // ─ Модальное ─
  const [modal, setModal] = useState<Modal_>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Форма заявки на ремонт
  const [rTruckId, setRTruckId] = useState("");
  const [rDriverId, setRDriverId] = useState("");
  const [rText, setRText] = useState("");
  const [rPriority, setRPriority] = useState<"обычная" | "срочная">("обычная");

  // Форма пробега
  const [mTruckId, setMTruckId] = useState("");
  const [mDriverId, setMDriverId] = useState("");
  const [mDate, setMDate] = useState(new Date().toISOString().slice(0, 10));
  const [mOdometer, setMOdometer] = useState("");
  const [mNote, setMNote] = useState("");
  const [mIsService, setMIsService] = useState(false);

  // Форма расхода
  const [expModal, setExpModal] = useState(false);
  const [eSaving, setESaving] = useState(false);
  const [eError, setEError] = useState<string | null>(null);
  const [eDate, setEDate] = useState(new Date().toISOString().slice(0, 10));
  const [eCategory, setECategory] = useState("");
  const [eAmount, setEAmount] = useState("");
  const [eBank, setEBank] = useState("");
  const [eTruckId, setETruckId] = useState("");
  const [ePurpose, setEPurpose] = useState("");

  // Закрытие заявки на ремонт
  const [closeId, setCloseId] = useState<number | null>(null);
  const [closeComment, setCloseComment] = useState("");
  const [closeSaving, setCloseSaving] = useState(false);

  // Детальный просмотр карточек
  const [selectedTruck, setSelectedTruck] = useState<FTruck | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<FDriver | null>(null);
  const [driverDetail, setDriverDetail] = useState<FullDriverDetail | null>(null);
  const [driverDetailLoading, setDriverDetailLoading] = useState(false);

  // Форма пробега (свёрнута по умолчанию)
  const [showMileageForm, setShowMileageForm] = useState(false);

  // Раскрытые карточки рейсов
  const [expandedTrips, setExpandedTrips] = useState<Set<number>>(new Set());
  function toggleTrip(id: number) {
    setExpandedTrips(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Фильтры рейсов
  const [tripFrom, setTripFrom] = useState("");
  const [tripTo, setTripTo] = useState("");
  const [tripTruckFilter, setTripTruckFilter] = useState("");
  const [tripDriverFilter, setTripDriverFilter] = useState("");

  // Активные сессии П/П авто
  const [activeSessions, setActiveSessions] = useState<Map<number, FActiveSession>>(new Map());
  const [fleetSessionId, setFleetSessionId] = useState<number | null>(null);
  const [fleetSessDetail, setFleetSessDetail] = useState<FleetSessDetail | null>(null);
  const [fleetSessLoading, setFleetSessLoading] = useState(false);

  // ─ Загрузка данных ────────────────────────────────────────────────────────
  async function loadAll() {
    setLoading(true);
    try {
      const [att, trs, drs, reps, cms, trps, mls, cats, sess, exps] = await Promise.allSettled([
        api.get<AttentionData>("/api/foreman-dashboard/attention"),
        api.get<FTruck[]>("/api/trucks/"),
        api.get<FDriver[]>("/api/foreman-dashboard/drivers"),
        api.get<FRepair[]>("/api/repair-requests/journal/"),
        api.get<FComp[]>("/api/compensation-requests/journal/"),
        api.get<FTrip[]>("/api/trips/"),
        api.get<FMileage[]>("/api/mileage-logs/"),
        api.get<{ id: number; name: string }[]>("/api/expense-categories/"),
        api.get<FActiveSession[]>("/api/vehicle-inspections/active-sessions"),
        api.get<FExpense[]>("/api/expenses/"),
      ]);
      if (att.status === "fulfilled") setAttention(att.value);
      if (trs.status === "fulfilled") setTrucks(trs.value);
      if (drs.status === "fulfilled") setDrivers(drs.value);
      if (reps.status === "fulfilled") setRepairs(reps.value);
      if (cms.status === "fulfilled") setComps(cms.value);
      if (trps.status === "fulfilled") {
        // Последние 100 рейсов
        const sorted = [...trps.value].sort(
          (a, b) => new Date(b.dep_at).getTime() - new Date(a.dep_at).getTime()
        );
        setTrips(sorted.slice(0, 100));
      }
      if (mls.status === "fulfilled") {
        const sorted = [...mls.value].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        setMileages(sorted.slice(0, 50));
      }
      if (cats.status === "fulfilled") setExpCats(cats.value.map((c: { name: string }) => c.name));
      if (sess.status === "fulfilled") setActiveSessions(new Map(sess.value.map(s => [s.truck_id, s])));
      if (exps.status === "fulfilled") {
        const since = new Date();
        since.setDate(since.getDate() - 30);
        const sinceStr = since.toISOString().slice(0, 10);
        const mine = (exps.value as FExpense[])
          .filter(e => e.created_by_user_id === user?.id && e.date >= sinceStr && e.expense > 0)
          .sort((a, b) => b.date.localeCompare(a.date));
        setMyExpenses(mine);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  // Справочники для форм
  const driverMap = Object.fromEntries(drivers.map(d => [d.id, d.name]));
  const truckMap = Object.fromEntries(trucks.map(t => [t.id, t.plate]));

  // ─ Действия ──────────────────────────────────────────────────────────────
  function openModal(m: Modal_) {
    setFormError(null);
    setModal(m);
  }

  async function submitRepair() {
    if (!rText.trim()) { setFormError("Введите описание"); return; }
    setSaving(true); setFormError(null);
    try {
      await api.post("/api/repair-requests/", {
        truck_id: rTruckId ? Number(rTruckId) : null,
        driver_id: rDriverId ? Number(rDriverId) : null,
        text: rText.trim(),
        priority: rPriority,
      });
      setModal(null); setRText(""); setRTruckId(""); setRDriverId(""); setRPriority("обычная");
      await loadAll();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Ошибка сохранения");
    } finally { setSaving(false); }
  }

  async function submitMileage() {
    if (!mTruckId) { setFormError("Выберите машину"); return; }
    setSaving(true); setFormError(null);
    try {
      await api.post("/api/mileage-logs/", {
        date: mDate,
        truck_id: Number(mTruckId),
        driver_id: mDriverId ? Number(mDriverId) : null,
        odometer: mOdometer ? Number(mOdometer) : null,
        is_service: mIsService,
        note: mNote,
      });
      setModal(null); setMTruckId(""); setMDriverId(""); setMOdometer(""); setMNote(""); setMIsService(false);
      setShowMileageForm(false);
      await loadAll();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Ошибка сохранения");
    } finally { setSaving(false); }
  }

  async function submitExpense() {
    if (!eCategory || !eAmount || Number(eAmount) <= 0) {
      setEError("Укажите статью и сумму"); return;
    }
    setESaving(true); setEError(null);
    try {
      const month = eDate.slice(5, 7) + "-" + eDate.slice(0, 4); // "07-2026"
      await api.post("/api/expenses/", {
        date: eDate,
        status: "ОПЛАЧЕНО",
        expense: Number(eAmount),
        income: 0,
        bank: eBank,
        category: eCategory,
        purpose: ePurpose,
        period: month,
        truck_id: eTruckId ? Number(eTruckId) : null,
        driver_id: null,
        vat_pct: 0,
        counterparty: "",
        fuel_source_key: "",
      });
      setExpModal(false);
      setEDate(new Date().toISOString().slice(0, 10));
      setECategory(""); setEAmount(""); setEBank(""); setETruckId(""); setEPurpose("");
      await loadAll();
    } catch (e) {
      setEError(e instanceof ApiError ? e.message : "Ошибка сохранения");
    } finally { setESaving(false); }
  }

  async function changeRepairStatus(id: number, status: RepairStatus) {
    await api.put(`/api/repair-requests/${id}`, { status });
    setRepairs(prev => prev.map(r => r.id === id ? { ...r, status } : r));
  }

  async function closeRepair() {
    if (!closeId) return;
    setCloseSaving(true);
    try {
      await api.put(`/api/repair-requests/${closeId}`, {
        status: "закрыта",
        close_comment: closeComment,
      });
      setRepairs(prev => prev.map(r =>
        r.id === closeId ? { ...r, status: "закрыта", close_comment: closeComment } : r
      ));
      setCloseId(null); setCloseComment("");
    } catch { /* тихо */ } finally { setCloseSaving(false); }
  }

  async function openDriverDetail(d: FDriver) {
    setSelectedDriver(d);
    setDriverDetail(null);
    setDriverDetailLoading(true);
    try {
      const detail = await api.get<FullDriverDetail>(`/api/drivers/${d.id}`);
      setDriverDetail(detail);
    } catch { /* используем только данные FDriver */ }
    finally { setDriverDetailLoading(false); }
  }

  async function openFleetSession(sessionId: number) {
    setSelectedTruck(null); // закрываем карточку машины, если открыта
    setFleetSessionId(sessionId);
    setFleetSessDetail(null);
    setFleetSessLoading(true);
    try {
      const det = await api.get<FleetSessDetail>(`/api/vehicle-inspections/sessions/${sessionId}`);
      setFleetSessDetail(det);
    } catch { /* тихо */ }
    finally { setFleetSessLoading(false); }
  }

  // ─ Рендер разделов ───────────────────────────────────────────────────────

  function renderHome() {
    const att = attention;
    const alertCount = (att?.expiring_docs.length ?? 0)
      + (att?.open_repairs_count ?? 0)
      + (att?.pending_comps_count ?? 0);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Виджет «Требует внимания» */}
        <SCard>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 12 }}>
            {alertCount > 0 ? "⚠️ Требует внимания" : "✅ Всё в порядке"}
          </div>

          {alertCount === 0 && (
            <p style={{ color: C.ink2, fontSize: 13, margin: 0 }}>Нет открытых задач и истекающих документов.</p>
          )}

          {/* Истекающие документы */}
          {(att?.expiring_docs ?? []).map((d, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 0", borderBottom: `1px solid ${C.border}`,
            }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 13, color: C.ink }}>
                  {d.label} — {d.doc_type}
                </span>
                <div style={{ fontSize: 12, color: d.critical ? C.danger : C.warn, marginTop: 2 }}>
                  {d.days_left < 0
                    ? `Просрочен ${Math.abs(d.days_left)} дн. назад`
                    : `Истекает через ${d.days_left} дн.`}
                </div>
              </div>
              <div style={{ fontSize: 12, color: d.critical ? C.danger : C.warn, fontWeight: 600 }}>
                {fmtDate(d.expiry_date)}
              </div>
            </div>
          ))}

          {/* Срочные заявки — клик переводит в журнал ремонтных заявок */}
          {(att?.urgent_repairs ?? []).map(r => (
            <div key={r.id}
              onClick={() => { setSection("requests"); setReqTab("repairs"); }}
              style={{
                padding: "8px 0", borderBottom: `1px solid ${C.border}`,
                cursor: "pointer",
              }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.danger }}>
                🔧 Срочно: {r.truck_label} — {r.driver_name}
              </div>
              <div style={{ fontSize: 12, color: C.ink2, marginTop: 2 }}>{r.text}</div>
              <div style={{ fontSize: 11, color: C.iris, marginTop: 2 }}>→ открыть журнал заявок</div>
            </div>
          ))}

          {/* Счётчики */}
          {(att?.open_repairs_count ?? 0) > 0 && (
            <div style={{ fontSize: 12, color: C.ink2, marginTop: 8 }}>
              🔧 Открытых заявок на ремонт: <b style={{ color: C.ink }}>{att?.open_repairs_count}</b>
            </div>
          )}
          {(att?.pending_comps_count ?? 0) > 0 && (
            <div style={{ fontSize: 12, color: C.ink2, marginTop: 4 }}>
              💸 Заявок на компенсацию: <b style={{ color: C.ink }}>{att?.pending_comps_count}</b>
            </div>
          )}
        </SCard>

        {/* Быстрые действия */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <ActionBtn icon="🔧" label="Заявка на ремонт" onClick={() => openModal("repair")} accent />
          <ActionBtn icon="📏" label="Внести пробег" onClick={() => openModal("mileage")} />
          <ActionBtn icon="💰" label="Расход" onClick={() => { setEError(null); setExpModal(true); }} />
        </div>

        {/* Мои расходы за 30 дней */}
        <SCard>
          <div style={{ fontWeight: 700, fontSize: 15, color: C.ink, marginBottom: 10 }}>
            💰 Мои расходы <span style={{ fontWeight: 400, fontSize: 13, color: C.ink2 }}>(30 дней)</span>
          </div>
          {myExpenses.length === 0 ? (
            <p style={{ color: C.ink2, fontSize: 13, margin: 0 }}>Нет записей за последние 30 дней</p>
          ) : (
            <>
              <div style={{
                fontSize: 13, fontWeight: 700, color: C.danger,
                marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${C.border}`,
              }}>
                Итого: {money(myExpenses.reduce((s, e) => s + e.expense, 0))}
              </div>
              {myExpenses.slice(0, 10).map(e => (
                <div key={e.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                  padding: "7px 0", borderBottom: `1px solid ${C.border}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{e.category}</div>
                    <div style={{ fontSize: 11, color: C.ink2, marginTop: 2 }}>
                      {fmtDate(e.date)}
                      {e.bank ? ` · ${e.bank}` : ""}
                      {e.truck_id && truckMap[e.truck_id] ? ` · ${truckMap[e.truck_id]}` : ""}
                    </div>
                    {e.purpose && (
                      <div style={{ fontSize: 11, color: C.ink2, marginTop: 1 }}>{e.purpose}</div>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.danger, flexShrink: 0, marginLeft: 10 }}>
                    {money(e.expense)}
                  </div>
                </div>
              ))}
              {myExpenses.length > 10 && (
                <div style={{ fontSize: 12, color: C.ink2, textAlign: "center", marginTop: 6 }}>
                  + ещё {myExpenses.length - 10} записей
                </div>
              )}
            </>
          )}
        </SCard>
      </div>
    );
  }

  function renderFleet() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {trucks.length === 0 && <p style={{ color: C.ink2, textAlign: "center" }}>Нет данных</p>}
        {trucks.map(t => {
          const osagoD = daysLeft(t.osago_date);
          const techD  = daysLeft(t.tech_inspection_date);
          const kaskoD = daysLeft(t.kasko_date);
          return (
            <SCard key={t.id} style={{ cursor: "pointer" }} onClick={() => setSelectedTruck(t)}>
              <div style={{ fontWeight: 700, fontSize: 15, color: C.ink }}>
                {t.plate}{t.brand ? ` — ${t.brand}` : ""}
              </div>
              {t.body_type && (
                <div style={{ fontSize: 12, color: C.ink2, marginTop: 2 }}>{t.body_type}</div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                {[
                  { label: "ОСАГО", days: osagoD, date: t.osago_date },
                  { label: "ТехОсмотр", days: techD, date: t.tech_inspection_date },
                  { label: "КАСКО", days: kaskoD, date: t.kasko_date },
                ].filter(d => d.date).map(d => (
                  <div key={d.label} style={{
                    fontSize: 11, padding: "3px 8px", borderRadius: 8,
                    background: `${docColor(d.days)}22`,
                    color: docColor(d.days), fontWeight: 600,
                  }}>
                    {d.label}: {fmtDate(d.date)}
                    {d.days !== null && d.days <= 30 && (
                      <span> ({d.days < 0 ? `${Math.abs(d.days)}д просрочен` : `${d.days}д`})</span>
                    )}
                  </div>
                ))}
              </div>
              {/* Пробег / остаток до ТО */}
              {(() => {
                const stats = getTruckToStats(t.id, t.maintenance_interval_km, mileages);
                if (!stats) return null;
                const col = stats.kmSince != null ? toKmColor(stats.kmSince) : C.ink2;
                return (
                  <div style={{
                    marginTop: 10, paddingTop: 8,
                    borderTop: `1px solid ${C.border}`,
                    display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap",
                  }}>
                    {/* Последний одометр */}
                    <div>
                      <div style={{ fontSize: 10, color: C.ink2, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>
                        Одометр
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
                        {stats.lastOdometer.toLocaleString("ru-RU")} км
                      </div>
                    </div>
                    {/* Пробег с ТО */}
                    {stats.kmSince != null && (
                      <div>
                        <div style={{ fontSize: 10, color: C.ink2, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>
                          С ТО
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: col }}>
                          {stats.kmSince.toLocaleString("ru-RU")} км
                        </div>
                      </div>
                    )}
                    {/* Остаток до ТО */}
                    {stats.remaining != null && (
                      <div>
                        <div style={{ fontSize: 10, color: C.ink2, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>
                          До ТО
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: col }}>
                          {stats.remaining >= 0
                            ? `${stats.remaining.toLocaleString("ru-RU")} км`
                            : `−${Math.abs(stats.remaining).toLocaleString("ru-RU")} км ❗`}
                        </div>
                      </div>
                    )}
                    {/* Цветная точка-индикатор */}
                    {stats.kmSince != null && (
                      <div style={{
                        marginLeft: "auto", alignSelf: "center",
                        width: 10, height: 10, borderRadius: "50%",
                        background: col, flexShrink: 0,
                        boxShadow: `0 0 0 3px ${col}22`,
                      }} />
                    )}
                  </div>
                );
              })()}

              {/* Активная сессия П/П */}
              {(() => {
                const sess = activeSessions.get(t.id);
                if (!sess) return null;
                return (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); openFleetSession(sess.session_id); }}
                    style={{
                      marginTop: 10, background: "#27ae6015", border: "1px solid #27ae6040",
                      borderRadius: 10, padding: "6px 10px", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 6,
                      fontFamily: "inherit", textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 15 }}>🟢</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#27ae60" }}>{sess.driver_name}</div>
                      <div style={{ fontSize: 11, color: C.ink2 }}>с {fmtDate(sess.started_at)} · нажмите для акта П/П</div>
                    </div>
                  </button>
                );
              })()}
            </SCard>
          );
        })}
      </div>
    );
  }

  function renderTeam() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {drivers.filter(d => d.active).map(d => (
          <SCard key={d.id} style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
            onClick={() => openDriverDetail(d)}>
            <div style={{
              width: 42, height: 42, borderRadius: 12,
              background: d.role === "foreman" ? C.foremanL : C.border,
              display: "grid", placeItems: "center",
              fontSize: 18, flexShrink: 0,
            }}>
              {d.role === "foreman" ? "👷" : "🚗"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.ink, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {d.name}
                <RoleBadge role={d.role} />
              </div>
              {d.truck_plate && (
                <div style={{ fontSize: 12, color: C.ink2, marginTop: 2 }}>🚛 {d.truck_plate}</div>
              )}
              {d.phone && (
                <div style={{ fontSize: 12, color: C.iris, marginTop: 2 }}>{d.phone}</div>
              )}
            </div>
            {d.phone && (
              <a href={`tel:${d.phone}`} onClick={e => e.stopPropagation()} style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 38, height: 38, borderRadius: 10,
                background: C.irisLight, color: C.iris,
                textDecoration: "none", fontSize: 18, flexShrink: 0,
              }}>📞</a>
            )}
          </SCard>
        ))}
        {drivers.filter(d => !d.active).length > 0 && (
          <p style={{ fontSize: 12, color: C.ink2, textAlign: "center", margin: "4px 0 0" }}>
            Неактивных: {drivers.filter(d => !d.active).length}
          </p>
        )}
      </div>
    );
  }

  function renderTrips() {
    return (
      <div>
        {/* Подвкладки */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {(["list", "mileage"] as const).map(t => (
            <button key={t} type="button" onClick={() => setTripsTab(t)} style={{
              flex: 1, padding: "9px 0", border: "none", borderRadius: 10,
              fontWeight: 600, fontSize: 13, fontFamily: "inherit", cursor: "pointer",
              background: tripsTab === t ? C.foreman : C.card,
              color: tripsTab === t ? "#fff" : C.ink2,
            }}>
              {t === "list" ? "🚚 Рейсы" : "📏 Пробеги"}
            </button>
          ))}
        </div>

        {tripsTab === "list" && (() => {
          const filteredTrips = trips.filter(t => {
            if (tripFrom && t.dep_at.slice(0, 10) < tripFrom) return false;
            if (tripTo && t.dep_at.slice(0, 10) > tripTo) return false;
            if (tripTruckFilter && String(t.truck_id) !== tripTruckFilter) return false;
            if (tripDriverFilter && String(t.driver_id) !== tripDriverFilter) return false;
            return true;
          });
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Фильтры */}
              <SCard style={{ padding: "12px 14px" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 11, color: C.ink2, marginBottom: 3 }}>С</div>
                    <input type="date" style={{ ...inputSt, padding: "8px 10px", fontSize: 13 }}
                      value={tripFrom} onChange={e => setTripFrom(e.target.value)} />
                  </div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 11, color: C.ink2, marginBottom: 3 }}>По</div>
                    <input type="date" style={{ ...inputSt, padding: "8px 10px", fontSize: 13 }}
                      value={tripTo} onChange={e => setTripTo(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select style={{ ...inputSt, flex: 1, padding: "8px 10px", fontSize: 13 }}
                    value={tripTruckFilter} onChange={e => setTripTruckFilter(e.target.value)}>
                    <option value="">Все машины</option>
                    {trucks.map(t => <option key={t.id} value={t.id}>{t.plate}</option>)}
                  </select>
                  <select style={{ ...inputSt, flex: 1, padding: "8px 10px", fontSize: 13 }}
                    value={tripDriverFilter} onChange={e => setTripDriverFilter(e.target.value)}>
                    <option value="">Все водители</option>
                    {drivers.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                {(tripFrom || tripTo || tripTruckFilter || tripDriverFilter) && (
                  <button type="button" onClick={() => {
                    setTripFrom(""); setTripTo(""); setTripTruckFilter(""); setTripDriverFilter("");
                  }} style={{
                    marginTop: 8, width: "100%", border: "none", borderRadius: 8,
                    padding: "7px 0", fontSize: 12, fontFamily: "inherit",
                    cursor: "pointer", background: C.border, color: C.ink2,
                  }}>
                    Сбросить фильтры · {filteredTrips.length} из {trips.length}
                  </button>
                )}
              </SCard>

              {filteredTrips.length === 0 && (
                <p style={{ color: C.ink2, textAlign: "center" }}>Нет рейсов</p>
              )}
              {filteredTrips.map(t => {
                const isOpen = expandedTrips.has(t.id);
                return (
                  <SCard key={t.id} style={{ cursor: "pointer" }}
                    onClick={() => toggleTrip(t.id)}>
                    {/* Основная строка */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>
                          {t.source} — {t.request_number}
                        </div>
                        <div style={{ fontSize: 12, color: C.ink2, marginTop: 2 }}>
                          {fmtDate(t.dep_at)}
                          {t.driver_id && driverMap[t.driver_id] ? ` · ${driverMap[t.driver_id]}` : ""}
                          {t.truck_id && truckMap[t.truck_id] ? ` · ${truckMap[t.truck_id]}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{money(t.amount)}</div>
                          <div style={{ fontSize: 11, color: C.ink2, marginTop: 2 }}>{t.status}</div>
                        </div>
                        <div style={{
                          fontSize: 12, color: C.iris, transition: "transform .2s",
                          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                          lineHeight: 1,
                        }}>▾</div>
                      </div>
                    </div>

                    {/* Раскрытая часть */}
                    {isOpen && (
                      <div style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: `1px solid ${C.border}`,
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: "8px 12px",
                      }} onClick={e => e.stopPropagation()}>
                        <DetailRow label="Погрузка" value={fmtDateTime(t.dep_at)} />
                        <DetailRow label="Разгрузка" value={fmtDateTime(t.end_at)} />
                        {t.tariff_type && <DetailRow label="Тариф" value={t.tariff_type} />}
                        {t.carrier_name && <DetailRow label="Перевозчик" value={t.carrier_name} />}
                        {t.external_request_number && (
                          <DetailRow label="Заявка клиента" value={t.external_request_number} />
                        )}
                        {t.driver_phone && <DetailRow label="Тел. водителя" value={t.driver_phone} />}
                        {t.fines > 0 && (
                          <DetailRow
                            label="Штрафы"
                            value={money(t.fines)}
                            valueStyle={{ color: C.danger, fontWeight: 600 }}
                          />
                        )}
                      </div>
                    )}
                  </SCard>
                );
              })}
            </div>
          );
        })()}

        {tripsTab === "mileage" && (
          <div>
            {/* Кнопка / форма добавления пробега */}
            {!showMileageForm ? (
              <button type="button" onClick={() => setShowMileageForm(true)} style={{
                width: "100%", border: `2px dashed ${C.foreman}`, borderRadius: C.radius,
                padding: "14px 0", fontSize: 14, fontWeight: 700, fontFamily: "inherit",
                cursor: "pointer", background: C.foremanL, color: C.foreman,
                marginBottom: 14,
              }}>
                + Добавить пробег
              </button>
            ) : (
              <SCard style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.ink }}>Внести пробег</div>
                  <button type="button" onClick={() => setShowMileageForm(false)} style={{
                    background: "none", border: "none", fontSize: 18, color: C.ink2, cursor: "pointer",
                  }}>✕</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <select style={inputSt} value={mTruckId} onChange={e => setMTruckId(e.target.value)}>
                    <option value="">Машина *</option>
                    {trucks.map(t => <option key={t.id} value={t.id}>{t.plate}</option>)}
                  </select>
                  <select style={inputSt} value={mDriverId} onChange={e => setMDriverId(e.target.value)}>
                    <option value="">Водитель (необязательно)</option>
                    {drivers.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <input type="date" style={inputSt} value={mDate} onChange={e => setMDate(e.target.value)} />
                  <input type="number" placeholder="Одометр (км)" style={inputSt}
                    value={mOdometer} onChange={e => setMOdometer(e.target.value)} />
                  <input type="text" placeholder="Примечание" style={inputSt}
                    value={mNote} onChange={e => setMNote(e.target.value)} />
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.ink }}>
                    <input type="checkbox" checked={mIsService} onChange={e => setMIsService(e.target.checked)} />
                    ТО / сервис
                  </label>
                  {formError && <p style={{ color: C.danger, fontSize: 12, margin: 0 }}>{formError}</p>}
                  <button type="button" onClick={submitMileage} disabled={saving} style={{
                    background: C.foreman, color: "#fff", border: "none", borderRadius: 10,
                    padding: "12px 0", fontSize: 14, fontWeight: 700, fontFamily: "inherit",
                    cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
                  }}>
                    {saving ? "Сохраняем..." : "Сохранить пробег"}
                  </button>
                </div>
              </SCard>
            )}

            {/* Журнал пробегов */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {mileages.map(m => (
                <SCard key={m.id}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>
                        {truckMap[m.truck_id] ?? `#${m.truck_id}`}
                        {m.is_service && <span style={{ marginLeft: 6, fontSize: 11, color: C.warn }}>ТО</span>}
                      </div>
                      <div style={{ fontSize: 12, color: C.ink2, marginTop: 2 }}>
                        {fmtDate(m.date)}
                        {m.driver_id && driverMap[m.driver_id] ? ` · ${driverMap[m.driver_id]}` : ""}
                      </div>
                      {m.note && <div style={{ fontSize: 12, color: C.ink2, marginTop: 2 }}>{m.note}</div>}
                    </div>
                    {m.odometer != null && (
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>
                        {m.odometer.toLocaleString("ru-RU")} км
                      </div>
                    )}
                  </div>
                </SCard>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderRequests() {
    return (
      <div>
        {/* Подвкладки */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {(["repairs", "comps"] as const).map(t => (
            <button key={t} type="button" onClick={() => setReqTab(t)} style={{
              flex: 1, padding: "9px 0", border: "none", borderRadius: 10,
              fontWeight: 600, fontSize: 13, fontFamily: "inherit", cursor: "pointer",
              background: reqTab === t ? C.foreman : C.card,
              color: reqTab === t ? "#fff" : C.ink2,
            }}>
              {t === "repairs" ? "🔧 Ремонт" : "💸 Компенсации"}
            </button>
          ))}
        </div>

        {reqTab === "repairs" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {repairs.length === 0 && <p style={{ color: C.ink2, textAlign: "center" }}>Нет заявок</p>}
            {repairs.map(r => (
              <SCard key={r.id}>
                {/* Заголовок */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Badge
                      text={r.status}
                      color={STATUS_COLORS[r.status] ?? C.ink2}
                      bg={`${STATUS_COLORS[r.status] ?? C.ink2}18`}
                    />
                    {r.priority === "срочная" && (
                      <Badge text="🔴 Срочно" color={C.danger} bg={`${C.danger}18`} />
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: C.ink2 }}>{fmtDate(r.created_at)}</span>
                </div>

                <div style={{ fontSize: 13, color: C.ink, marginBottom: 4 }}>{r.text}</div>

                <div style={{ fontSize: 12, color: C.ink2 }}>
                  {r.driver_name !== "—" && `👤 ${r.driver_name}`}
                  {r.truck_label !== "—" && ` 🚛 ${r.truck_label}`}
                </div>

                {r.close_comment && (
                  <div style={{ fontSize: 12, color: C.ink2, marginTop: 4, fontStyle: "italic" }}>
                    Комментарий: {r.close_comment}
                  </div>
                )}

                {/* Кнопки смены статуса */}
                {r.status === "создана" && (
                  <button type="button"
                    onClick={() => changeRepairStatus(r.id, "в работе")}
                    style={{
                      marginTop: 10, width: "100%", border: "none",
                      borderRadius: 9, padding: "9px 0", fontSize: 13,
                      fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                      background: "#3b82f618", color: "#3b82f6",
                    }}>
                    ▶ Взять в работу
                  </button>
                )}

                {r.status === "в работе" && (
                  closeId === r.id ? (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                      <input type="text" placeholder="Комментарий (необязательно)" style={inputSt}
                        value={closeComment} onChange={e => setCloseComment(e.target.value)} />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" onClick={() => setCloseId(null)} style={{
                          flex: 1, border: "none", borderRadius: 9, padding: "9px 0",
                          fontSize: 13, fontFamily: "inherit", cursor: "pointer",
                          background: C.border, color: C.ink2,
                        }}>Отмена</button>
                        <button type="button" onClick={closeRepair} disabled={closeSaving} style={{
                          flex: 2, border: "none", borderRadius: 9, padding: "9px 0",
                          fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                          background: C.good, color: "#fff", opacity: closeSaving ? 0.6 : 1,
                        }}>
                          {closeSaving ? "Сохраняем..." : "✓ Закрыть заявку"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button"
                      onClick={() => { setCloseId(r.id); setCloseComment(""); }}
                      style={{
                        marginTop: 10, width: "100%", border: "none",
                        borderRadius: 9, padding: "9px 0", fontSize: 13,
                        fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                        background: `${C.good}18`, color: C.good,
                      }}>
                      ✓ Закрыть заявку
                    </button>
                  )
                )}
              </SCard>
            ))}
          </div>
        )}

        {reqTab === "comps" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {comps.length === 0 && <p style={{ color: C.ink2, textAlign: "center" }}>Нет заявок</p>}
            {comps.map(c => {
              const statusColor = c.status === "принято" ? C.good
                : c.status === "отказано" ? C.danger : C.warn;
              return (
                <SCard key={c.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <Badge text={c.status} color={statusColor} bg={`${statusColor}18`} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{money(c.amount)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: C.ink, marginBottom: 2 }}>{c.category}</div>
                  {c.description && <div style={{ fontSize: 12, color: C.ink2 }}>{c.description}</div>}
                  <div style={{ fontSize: 12, color: C.ink2, marginTop: 4 }}>
                    👤 {c.driver_name} · {fmtDate(c.expense_date)}
                  </div>
                  {c.reject_reason && (
                    <div style={{ fontSize: 12, color: C.danger, marginTop: 4 }}>
                      Причина отказа: {c.reject_reason}
                    </div>
                  )}
                </SCard>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─ Полный чеклист акта П/П ───────────────────────────────────────────────
  // Показывает все пункты с цветным статусом (✓/✗/—), сгруппированные по блокам.
  // 2026-07-07: раньше показывались только проблемные пункты (status === "no").
  function renderInspFull(insp: FleetSessInspDetail, accentColor: string, accentLabel: string) {
    const blockMap = new Map<number, FleetSessInspItem[]>();
    insp.items.forEach(item => {
      if (!blockMap.has(item.block)) blockMap.set(item.block, []);
      blockMap.get(item.block)!.push(item);
    });
    const sortedBlocks = Array.from(blockMap.entries()).sort(([a], [b]) => a - b);
    const realDamages = insp.damages.filter(d =>
      !d.description.startsWith("Фото чистоты:") && !d.description.startsWith("4 стороны:")
    );
    return (
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: accentColor, marginBottom: 8 }}>{accentLabel}</div>
        {sortedBlocks.map(([blockNum, items]) => (
          <div key={blockNum} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: C.ink2, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>
              Блок {blockNum}
            </div>
            {items.map(item => {
              const ok  = item.status === "yes";
              const bad = item.status === "no";
              const color = bad ? C.danger : ok ? C.good : C.ink2;
              const icon  = bad ? "✗" : ok ? "✓" : "—";
              return (
                <div key={item.id} style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "4px 0", borderBottom: `1px solid ${C.border}`,
                  opacity: (!item.status || item.status === "na") ? 0.45 : 1,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color, minWidth: 14, flexShrink: 0 }}>{icon}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 12, color: C.ink }}>{item.label}</span>
                    {item.item_count != null && (
                      <span style={{ fontSize: 11, color: C.ink2 }}> ×{item.item_count}</span>
                    )}
                    {item.note && (
                      <div style={{ fontSize: 11, color: bad ? C.danger : C.ink2, marginTop: 1 }}>{item.note}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {realDamages.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 10, color: C.ink2, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Повреждения</div>
            {realDamages.map(d => (
              <div key={d.id} style={{ fontSize: 12, color: C.warn, padding: "3px 0" }}>
                ⚠ {d.description}
                {d.photo_path && (
                  <a href={`/photos/${d.photo_path}`} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: C.iris }}>📷</a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─ Навигация ─────────────────────────────────────────────────────────────
  const NAV: { id: Section; icon: string; label: string }[] = [
    { id: "home",     icon: "🏠", label: "Главная" },
    { id: "fleet",    icon: "🚛", label: "Парк" },
    { id: "team",     icon: "👥", label: "Команда" },
    { id: "trips",    icon: "📋", label: "Рейсы" },
    { id: "requests", icon: "📝", label: "Заявки" },
  ];

  const alertCount = (attention?.expiring_docs.length ?? 0)
    + (attention?.open_repairs_count ?? 0)
    + (attention?.pending_comps_count ?? 0);

  const initial = (user?.full_name || user?.username || "Б").charAt(0).toUpperCase();

  // ─ JSX ───────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100dvh",
      background: C.bg,
      color: C.ink,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      maxWidth: 480,
      margin: "0 auto",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Хедер — белый, как в DriverDashboard */}
      <div style={{
        background: C.card,
        borderBottom: `1px solid ${C.border}`,
        padding: "max(env(safe-area-inset-top, 0px), 14px) 18px 14px",
        display: "flex", alignItems: "center", gap: 12,
        position: "sticky", top: 0, zIndex: 50,
      }}>
        {/* Аватар — первая буква имени */}
        <div style={{
          width: 42, height: 42, borderRadius: "50%",
          background: C.foreman,
          display: "grid", placeItems: "center",
          color: "#fff", fontWeight: 700, fontSize: 17,
          flexShrink: 0,
        }}>
          {initial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: C.ink2, letterSpacing: 0.4, textTransform: "uppercase" }}>
            Бригадир
          </div>
          <div style={{
            fontWeight: 600, fontSize: 15, color: C.ink,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {user?.full_name || user?.username}
          </div>
        </div>
        <button type="button"
          onClick={() => navigate("/driver")}
          style={{
            background: C.irisLight, border: "none", borderRadius: 10,
            padding: "7px 13px", color: C.iris,
            fontSize: 13, fontWeight: 600, fontFamily: "inherit",
            cursor: "pointer", flexShrink: 0,
            WebkitTapHighlightColor: "transparent",
          }}>
          ← Водитель
        </button>
      </div>

      {/* Контент */}
      <div style={{ flex: 1, padding: "16px 14px 90px" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: C.ink2, paddingTop: 48, fontSize: 14 }}>
            Загрузка...
          </div>
        ) : (
          <>
            {section === "home"     && renderHome()}
            {section === "fleet"    && renderFleet()}
            {section === "team"     && renderTeam()}
            {section === "trips"    && renderTrips()}
            {section === "requests" && renderRequests()}
          </>
        )}
      </div>

      {/* Нижняя навигация — фиксирована, но центрирована под max-width 480 */}
      <nav style={{
        position: "fixed", bottom: 0,
        left: "50%", transform: "translateX(-50%)",
        width: "min(100vw, 480px)",
        background: C.card, borderTop: `1px solid ${C.border}`,
        display: "flex",
        paddingBottom: "env(safe-area-inset-bottom, 0)",
        zIndex: 100,
      }}>
        {NAV.map(n => (
          <button key={n.id} type="button" onClick={() => setSection(n.id)} style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            gap: 2, padding: "8px 0 6px", border: "none",
            background: "none", cursor: "pointer", position: "relative",
            color: section === n.id ? C.foreman : C.ink2,
            fontSize: 10, fontWeight: section === n.id ? 700 : 400,
            fontFamily: "inherit", transition: "color .15s",
          }}>
            <span style={{ fontSize: 20 }}>{n.icon}</span>
            {n.label}
            {/* Бейдж алертов на Главной */}
            {n.id === "home" && alertCount > 0 && (
              <span style={{
                position: "absolute", top: 4, right: "calc(50% - 14px)",
                background: C.danger, color: "#fff",
                borderRadius: "50%", fontSize: 9, fontWeight: 700,
                width: 14, height: 14, lineHeight: "14px",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {alertCount > 9 ? "9+" : alertCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Модал: Заявка на ремонт */}
      {modal === "repair" && (
        <Modal
          title="Новая заявка на ремонт"
          onClose={() => setModal(null)}
          onSubmit={submitRepair}
          saving={saving}
          error={formError}
          submitLabel="Создать заявку"
        >
          <select style={inputSt} value={rTruckId} onChange={e => setRTruckId(e.target.value)}>
            <option value="">Машина (необязательно)</option>
            {trucks.map(t => <option key={t.id} value={t.id}>{t.plate}</option>)}
          </select>
          <select style={inputSt} value={rDriverId} onChange={e => setRDriverId(e.target.value)}>
            <option value="">Водитель (необязательно)</option>
            {drivers.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <div style={{ display: "flex", gap: 8 }}>
            {(["обычная", "срочная"] as const).map(p => (
              <button key={p} type="button" onClick={() => setRPriority(p)} style={{
                flex: 1, border: "none", borderRadius: 9, padding: "10px 0",
                fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                background: rPriority === p ? (p === "срочная" ? C.danger : C.foreman) : C.border,
                color: rPriority === p ? "#fff" : C.ink2,
              }}>
                {p === "срочная" ? "🔴 Срочная" : "Обычная"}
              </button>
            ))}
          </div>
          <textarea
            placeholder="Описание неисправности *"
            style={{ ...inputSt, minHeight: 90, resize: "vertical" }}
            value={rText}
            onChange={e => setRText(e.target.value)}
          />
        </Modal>
      )}

      {/* Модал: Пробег */}
      {modal === "mileage" && (
        <Modal
          title="Внести показания одометра"
          onClose={() => setModal(null)}
          onSubmit={submitMileage}
          saving={saving}
          error={formError}
          submitLabel="Сохранить"
        >
          <select style={inputSt} value={mTruckId} onChange={e => setMTruckId(e.target.value)}>
            <option value="">Машина *</option>
            {trucks.map(t => <option key={t.id} value={t.id}>{t.plate}</option>)}
          </select>
          <select style={inputSt} value={mDriverId} onChange={e => setMDriverId(e.target.value)}>
            <option value="">Водитель (необязательно)</option>
            {drivers.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input type="date" style={inputSt} value={mDate} onChange={e => setMDate(e.target.value)} />
          <input type="number" placeholder="Одометр (км)" style={inputSt}
            value={mOdometer} onChange={e => setMOdometer(e.target.value)} />
          <input type="text" placeholder="Примечание" style={inputSt}
            value={mNote} onChange={e => setMNote(e.target.value)} />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.ink }}>
            <input type="checkbox" checked={mIsService} onChange={e => setMIsService(e.target.checked)} />
            ТО / сервисное обслуживание
          </label>
        </Modal>
      )}

      {/* Модал: Карточка машины */}
      {selectedTruck && (() => {
        const t = selectedTruck;
        const docs = [
          { label: "ОСАГО",      date: t.osago_date,            number: t.osago_number },
          { label: "ТехОсмотр",  date: t.tech_inspection_date,  number: t.tech_inspection_number },
          { label: "КАСКО",      date: t.kasko_date,            number: t.kasko_number },
          { label: "СТС",        date: t.sts_date,              number: t.sts_number },
        ].filter(d => d.date || d.number);
        return (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            zIndex: 200, padding: "0 0 env(safe-area-inset-bottom,0)",
          }} onClick={() => setSelectedTruck(null)}>
            <div style={{
              background: C.card, borderRadius: "20px 20px 0 0",
              width: "100%", maxWidth: 520, maxHeight: "88vh", overflow: "auto",
              padding: "20px 18px 28px",
            }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
                <span style={{ flex: 1, fontWeight: 700, fontSize: 16, color: C.ink }}>🚛 {t.plate}</span>
                <button type="button" onClick={() => setSelectedTruck(null)} style={{
                  background: "none", border: "none", fontSize: 22, color: C.ink2,
                  cursor: "pointer", lineHeight: 1, padding: "0 4px",
                }}>✕</button>
              </div>

              {/* Основные данные */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                {[
                  { l: "Наименование", v: t.label },
                  { l: "Марка", v: [t.brand, t.year].filter(Boolean).join(" · ") },
                  { l: "Тип", v: t.vehicle_type },
                  { l: "Кузов", v: t.body_type },
                  { l: "ВИН", v: t.vin },
                  { l: "Шасси", v: t.chassis_number },
                  { l: "ПТС / ЭПТС", v: t.pts_number },
                  { l: "Интервал ТО", v: t.maintenance_interval_km ? `${t.maintenance_interval_km.toLocaleString("ru-RU")} км` : "" },
                ].filter(r => r.v).map(r => (
                  <div key={r.l}>
                    <div style={{ fontSize: 11, color: C.ink2 }}>{r.l}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, marginTop: 2 }}>{r.v}</div>
                  </div>
                ))}
              </div>

              {/* Документы */}
              {docs.length > 0 && (
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 12, color: C.ink2, fontWeight: 600, marginBottom: 8 }}>ДОКУМЕНТЫ</div>
                  {docs.map(d => {
                    const days = daysLeft(d.date);
                    const col = docColor(days);
                    return (
                      <div key={d.label} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "7px 0", borderBottom: `1px solid ${C.border}`,
                      }}>
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{d.label}</span>
                          {d.number && <div style={{ fontSize: 11, color: C.ink2 }}>{d.number}</div>}
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: col }}>{fmtDate(d.date)}</div>
                          {days !== null && (
                            <div style={{ fontSize: 11, color: col }}>
                              {days < 0 ? `просрочен ${Math.abs(days)} дн.` : `${days} дн.`}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {t.notes && (
                <div style={{ marginTop: 12, fontSize: 13, color: C.ink2, fontStyle: "italic" }}>{t.notes}</div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Модал: Карточка водителя */}
      {selectedDriver && (() => {
        const d = selectedDriver;
        const det = driverDetail;
        const fio = [det?.last_name, det?.first_name, det?.middle_name].filter(Boolean).join(" ") || d.name;
        return (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            zIndex: 200, padding: "0 0 env(safe-area-inset-bottom,0)",
          }} onClick={() => setSelectedDriver(null)}>
            <div style={{
              background: C.card, borderRadius: "20px 20px 0 0",
              width: "100%", maxWidth: 520, maxHeight: "88vh", overflow: "auto",
              padding: "20px 18px 28px",
            }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
                <span style={{ flex: 1, fontWeight: 700, fontSize: 16, color: C.ink }}>
                  {d.role === "foreman" ? "👷" : "👤"} {fio}
                </span>
                <button type="button" onClick={() => setSelectedDriver(null)} style={{
                  background: "none", border: "none", fontSize: 22, color: C.ink2,
                  cursor: "pointer", lineHeight: 1, padding: "0 4px",
                }}>✕</button>
              </div>

              <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                <RoleBadge role={d.role} />
                <Badge
                  text={d.active ? "Активен" : "Неактивен"}
                  color={d.active ? C.good : C.ink2}
                  bg={d.active ? `${C.good}18` : C.border}
                />
              </div>

              {driverDetailLoading && (
                <p style={{ color: C.ink2, fontSize: 13, textAlign: "center" }}>Загрузка данных...</p>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                {[
                  { l: "Телефон", v: d.phone },
                  { l: "Email", v: d.email },
                  { l: "Машина", v: d.truck_plate },
                  { l: "Дата рождения", v: det ? fmtDate(det.birth_date) : "" },
                ].filter(r => r.v && r.v !== "—").map(r => (
                  <div key={r.l}>
                    <div style={{ fontSize: 11, color: C.ink2 }}>{r.l}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, marginTop: 2 }}>
                      {r.l === "Телефон"
                        ? <a href={`tel:${r.v}`} style={{ color: C.iris, textDecoration: "none" }}>{r.v}</a>
                        : r.v}
                    </div>
                  </div>
                ))}
              </div>

              {det && (det.license_number || det.license_valid_until) && (
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: C.ink2, fontWeight: 600, marginBottom: 8 }}>ВОДИТЕЛЬСКОЕ УДОСТОВЕРЕНИЕ</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {det.license_number && (
                      <div>
                        <div style={{ fontSize: 11, color: C.ink2 }}>Серия / Номер</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, marginTop: 2 }}>{det.license_number}</div>
                      </div>
                    )}
                    {det.license_valid_until && (() => {
                      const days = daysLeft(det.license_valid_until);
                      const col = docColor(days);
                      return (
                        <div>
                          <div style={{ fontSize: 11, color: C.ink2 }}>Действ. до</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: col, marginTop: 2 }}>
                            {fmtDate(det.license_valid_until)}
                            {days !== null && days <= 30 && (
                              <span style={{ fontSize: 11, marginLeft: 4 }}>
                                ({days < 0 ? `просрочено` : `${days} дн.`})
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {det && (det.skzi_card_number || det.skzi_valid_until) && (
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 12, color: C.ink2, fontWeight: 600, marginBottom: 8 }}>КАРТА СКЗИ</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {det.skzi_card_number && (
                      <div>
                        <div style={{ fontSize: 11, color: C.ink2 }}>Номер</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, marginTop: 2 }}>{det.skzi_card_number}</div>
                      </div>
                    )}
                    {det.skzi_valid_until && (() => {
                      const days = daysLeft(det.skzi_valid_until);
                      const col = docColor(days);
                      return (
                        <div>
                          <div style={{ fontSize: 11, color: C.ink2 }}>Действ. до</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: col, marginTop: 2 }}>
                            {fmtDate(det.skzi_valid_until)}
                            {days !== null && days <= 30 && (
                              <span style={{ fontSize: 11, marginLeft: 4 }}>
                                ({days < 0 ? `просрочено` : `${days} дн.`})
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {det?.notes && (
                <div style={{ marginTop: 12, fontSize: 13, color: C.ink2, fontStyle: "italic" }}>{det.notes}</div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Модал: Добавить расход */}
      {expModal && (
        <Modal
          title="Добавить расход"
          onClose={() => { setExpModal(false); setEError(null); }}
          onSubmit={submitExpense}
          saving={eSaving}
          error={eError}
          submitLabel="Добавить расход"
        >
          <input type="date" style={inputSt} value={eDate} onChange={e => setEDate(e.target.value)} />
          <select style={inputSt} value={eCategory} onChange={e => setECategory(e.target.value)}>
            <option value="">Статья *</option>
            {expCats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            type="number"
            inputMode="decimal"
            placeholder="Сумма (₽) *"
            style={inputSt}
            value={eAmount}
            onChange={e => setEAmount(e.target.value)}
          />
          <select style={inputSt} value={eBank} onChange={e => setEBank(e.target.value)}>
            <option value="">Банк / источник</option>
            {["АльфаКарта", "Альфабанк", "Личные", "Фирма", "Наличные"].map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <select style={inputSt} value={eTruckId} onChange={e => setETruckId(e.target.value)}>
            <option value="">Машина (необязательно)</option>
            {trucks.map(t => <option key={t.id} value={t.id}>{t.plate}</option>)}
          </select>
          <input
            type="text"
            placeholder="Назначение (необязательно)"
            style={inputSt}
            value={ePurpose}
            onChange={e => setEPurpose(e.target.value)}
          />
        </Modal>
      )}

      {/* Модал: Акт приёмки-сдачи (флот) */}
      {fleetSessionId !== null && (
        <Modal title="Акт приёмки-сдачи" onClose={() => { setFleetSessionId(null); setFleetSessDetail(null); }}>
          {fleetSessLoading && <p style={{ color: C.ink2, fontSize: 13, textAlign: "center" }}>Загрузка...</p>}
          {fleetSessDetail && (() => {
            const det = fleetSessDetail;
            const fmtDT = (iso: string | null) => {
              if (!iso) return "—";
              return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
            };
            return (
              <>
                {/* Шапка сессии */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "10px 12px", background: C.bg, borderRadius: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: C.ink2 }}>Водитель</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{det.driver_name}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: C.ink2 }}>Машина</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{det.truck_plate}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: C.ink2 }}>Принята</div>
                    <div style={{ fontSize: 12, color: C.ink }}>{fmtDT(det.started_at)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: C.ink2 }}>Сдана</div>
                    <div style={{ fontSize: 12, color: det.ended_at ? C.ink : C.good, fontWeight: det.ended_at ? 400 : 700 }}>
                      {det.ended_at ? fmtDT(det.ended_at) : "В пути"}
                    </div>
                  </div>
                </div>

                {/* Пробеги */}
                {(det.start_inspection?.odometer != null || det.end_inspection?.odometer != null) && (
                  <div style={{ display: "flex", gap: 8 }}>
                    {det.start_inspection?.odometer != null && (
                      <div style={{ flex: 1, padding: "8px 10px", background: "#27ae6010", borderRadius: 8, border: "1px solid #27ae6030" }}>
                        <div style={{ fontSize: 11, color: C.ink2 }}>При приёмке</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: C.good }}>{det.start_inspection.odometer.toLocaleString("ru-RU")} км</div>
                      </div>
                    )}
                    {det.end_inspection?.odometer != null && (
                      <div style={{ flex: 1, padding: "8px 10px", background: `${C.iris}10`, borderRadius: 8, border: `1px solid ${C.iris}30` }}>
                        <div style={{ fontSize: 11, color: C.ink2 }}>При сдаче</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: C.iris }}>{det.end_inspection.odometer.toLocaleString("ru-RU")} км</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Полный чеклист приёмки */}
                {det.start_inspection && renderInspFull(det.start_inspection, C.good, "📋 Приёмка")}

                {/* Полный чеклист сдачи */}
                {det.end_inspection && renderInspFull(det.end_inspection, C.iris, "🔑 Сдача")}

                {!det.start_inspection && !det.end_inspection && (
                  <p style={{ color: C.ink2, fontSize: 13, textAlign: "center" }}>Актов нет</p>
                )}
              </>
            );
          })()}
        </Modal>
      )}
    </div>
  );
}
