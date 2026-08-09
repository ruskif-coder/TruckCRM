/**
 * Мобильный дашборд бригадира.
 * Визуальный слой переписан под новую дизайн-систему (CSS custom properties).
 * Бизнес-логика, типы и хуки сохранены без изменений.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, fileUrl } from "../api";
import { moneyWhole as money } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import {
  IconDashboard, IconTruck, IconDrivers, IconTrips, IconRepairs,
  IconClose, IconPlus, IconChevronDown,
  IconPhone, IconCamera,
} from "../design-system/icons";

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
  photo_paths: string;
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

// ─── Вспомогательные ──────────────────────────────────────────────────────────
// money() импортируется из ../lib/format (moneyWhole — без копеек).
// fmtDate/fmtDateTime ниже намеренно с 2-значным годом — компактнее для мобилки.
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
  if (days === null) return "var(--text-3)";
  if (days < 0) return "var(--danger)";
  if (days <= 7) return "var(--danger)";
  if (days <= 30) return "var(--warn)";
  return "var(--success)";
}
function docBg(days: number | null): string {
  if (days === null) return "var(--surface-2)";
  if (days < 0) return "var(--danger-bg)";
  if (days <= 7) return "var(--danger-bg)";
  if (days <= 30) return "var(--warn-bg)";
  return "var(--success-bg)";
}

// Стиль таба-переключателя (Рейсы/Заявки) — общий для обоих сегментов.
function tabStyle(active: boolean): CSSProperties {
  return {
    flex: 1, padding: "8px 18px", borderRadius: "var(--r-md)",
    fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
    fontFamily: "var(--font-ui)",
    background: active ? "var(--invert)" : "transparent",
    color: active ? "var(--on-invert)" : "var(--text-3)",
  };
}

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
  if (kmSince >= 17000) return "var(--danger)";
  if (kmSince >= 15000) return "var(--warn)";
  return "var(--success)";
}

// ─── Общие стили ──────────────────────────────────────────────────────────────
const inputSt: CSSProperties = {
  width: "100%", padding: "11px 14px",
  border: "1px solid var(--line-strong)",
  borderRadius: "var(--r-md)",
  fontSize: 14, fontFamily: "var(--font-ui)",
  background: "var(--surface-2)", color: "var(--ink)",
  boxSizing: "border-box",
};

// DetailRow — рестайлинг
function DetailRow({ label, value, valueStyle }: { label: string; value: string; valueStyle?: CSSProperties }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-4)", textTransform: "uppercase" as const, letterSpacing: "0.07em", fontFamily: "var(--font-mono)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, ...valueStyle }}>{value}</div>
    </div>
  );
}

// Bottom-sheet overlay
function Sheet({ onClose, children, title, onSubmit, saving, error, submitLabel }: {
  title: string; onClose: () => void; children: React.ReactNode;
  onSubmit?: () => void; saving?: boolean; error?: string | null; submitLabel?: string;
}) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "var(--overlay)",
      zIndex: 200, display: "flex", alignItems: "flex-end",
    }} onClick={onClose}>
      <div style={{
        background: "var(--surface)", borderRadius: "var(--r-sheet) var(--r-sheet) 0 0",
        width: "100%", maxWidth: 480, margin: "0 auto",
        maxHeight: "88vh", overflow: "auto",
        padding: "20px 18px",
        paddingBottom: "max(env(safe-area-inset-bottom,0px),28px)",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <span style={{ flex: 1, fontWeight: 700, fontSize: 16, color: "var(--ink)" }}>{title}</span>
          <button type="button" onClick={onClose} style={{
            background: "var(--surface-2)", border: "none", borderRadius: "var(--r-sm)",
            width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "var(--text-2)",
          }}>
            <IconClose size={16} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {children}
        </div>
        {error && <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 8 }}>{error}</p>}
        {onSubmit && (
          <button type="button" onClick={onSubmit} disabled={saving} style={{
            marginTop: 16, width: "100%", background: "var(--invert)", color: "var(--on-invert)",
            border: "none", borderRadius: "var(--r-md)", padding: "14px 0", fontSize: 15,
            fontWeight: 700, fontFamily: "var(--font-ui)", cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}>
            {saving ? "Сохраняем..." : (submitLabel ?? "Сохранить")}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Главный компонент ────────────────────────────────────────────────────────
type Section = "home" | "fleet" | "team" | "trips" | "requests";
type Modal_ = "repair" | "mileage" | null;
type RepairStatus = "создана" | "в работе" | "закрыта";

export default function ForemanDashboard() {
  const { user } = useAuth();
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
  const [ePhotos, setEPhotos] = useState<string[]>([]);
  const [eUploading, setEUploading] = useState(false);

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
        api.get<FExpense[]>("/api/foreman-dashboard/my-expenses"),
      ]);
      if (att.status === "fulfilled") setAttention(att.value);
      if (trs.status === "fulfilled") setTrucks(trs.value);
      if (drs.status === "fulfilled") setDrivers(drs.value);
      if (reps.status === "fulfilled") setRepairs(reps.value);
      if (cms.status === "fulfilled") setComps(cms.value);
      if (trps.status === "fulfilled") {
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

  async function uploadExpensePhoto(file: File) {
    setEUploading(true);
    try {
      const res = await api.upload<{ filename: string }>("/api/foreman-dashboard/expense-photo", file);
      setEPhotos(prev => [...prev, res.filename]);
    } catch { /* тихо */ }
    finally { setEUploading(false); }
  }

  async function submitExpense() {
    if (!eCategory || !eAmount || Number(eAmount) <= 0) {
      setEError("Укажите статью и сумму"); return;
    }
    setESaving(true); setEError(null);
    try {
      const month = eDate.slice(5, 7) + "-" + eDate.slice(0, 4);
      await api.post("/api/foreman-dashboard/expense", {
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
        photo_paths: JSON.stringify(ePhotos),
      });
      setExpModal(false);
      setEDate(new Date().toISOString().slice(0, 10));
      setECategory(""); setEAmount(""); setEBank(""); setETruckId(""); setEPurpose("");
      setEPhotos([]);
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
    setSelectedTruck(null);
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

    // 14 sparkline bars from myExpenses
    const totalExpense = myExpenses.reduce((s, e) => s + e.expense, 0);
    const sparkData = (() => {
      const buckets = Array(14).fill(0);
      const now = Date.now();
      myExpenses.forEach(e => {
        const daysAgo = Math.floor((now - new Date(e.date).getTime()) / 86400000);
        const idx = 13 - Math.min(13, daysAgo);
        buckets[idx] += e.expense;
      });
      return buckets;
    })();
    const sparkMax = Math.max(...sparkData, 1);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Блок «Требует внимания» — чёрный */}
        <div style={{
          borderRadius: "var(--r-2xl)", padding: "16px 16px 12px",
          background: "var(--invert)", color: "var(--on-invert)", marginBottom: 0,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--on-invert)" }}>Требует внимания</span>
            {(att?.urgent_repairs.length ?? 0) > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 600, padding: "3px 8px",
                borderRadius: "var(--r-xs)", background: "var(--danger-dot)", color: "#fff",
              }}>
                {att!.urgent_repairs.length} критично
              </span>
            )}
          </div>

          {alertCount === 0 && (
            <p style={{ fontSize: 13, color: "rgba(255,255,255,.55)", margin: 0 }}>Всё в порядке</p>
          )}

          {(att?.expiring_docs ?? []).map((d, i) => (
            <div key={i} style={{
              padding: "12px 0", borderTop: "1px solid rgba(255,255,255,.1)",
              display: "flex", alignItems: "flex-start", gap: 10,
            }}>
              <div style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0, marginTop: 4,
                background: d.critical ? "var(--danger-dot)" : "#F2C14B",
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--on-invert)" }}>
                  {d.label} — {d.doc_type}
                </div>
                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.5)", marginTop: 2 }}>
                  {d.days_left < 0
                    ? `Просрочен ${Math.abs(d.days_left)} дн. назад`
                    : `Истекает через ${d.days_left} дн.`}
                </div>
              </div>
              <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "rgba(255,255,255,.45)", flexShrink: 0 }}>
                {fmtDate(d.expiry_date)}
              </div>
            </div>
          ))}

          {(att?.urgent_repairs ?? []).map(r => (
            <div key={r.id}
              onClick={() => { setSection("requests"); setReqTab("repairs"); }}
              style={{
                padding: "12px 0", borderTop: "1px solid rgba(255,255,255,.1)",
                display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
              }}>
              <div style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0, marginTop: 4,
                background: "var(--danger-dot)",
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--on-invert)" }}>
                  {r.truck_label} — {r.driver_name}
                </div>
                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.5)", marginTop: 2 }}>{r.text}</div>
              </div>
              <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "rgba(255,255,255,.45)", flexShrink: 0 }}>
                {fmtDate(r.created_at)}
              </div>
            </div>
          ))}
        </div>

        {/* Быстрые действия */}
        <div style={{
          display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2,
          WebkitOverflowScrolling: "touch",
        }}>
          <button type="button" onClick={() => openModal("repair")} style={{
            borderRadius: "var(--r-md)", padding: "13px 16px",
            display: "flex", alignItems: "center", gap: 8,
            whiteSpace: "nowrap", border: "none", cursor: "pointer",
            fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600,
            background: "var(--accent)", color: "var(--on-accent)", flexShrink: 0,
          }}>
            <IconPlus size={16} /> Заявка на ремонт
          </button>
          <button type="button" onClick={() => openModal("mileage")} style={{
            borderRadius: "var(--r-md)", padding: "13px 16px",
            display: "flex", alignItems: "center", gap: 8,
            whiteSpace: "nowrap", border: "1px solid var(--line)", cursor: "pointer",
            fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600,
            background: "var(--surface)", color: "var(--ink)", flexShrink: 0,
          }}>
            Внести пробег
          </button>
          <button type="button" onClick={() => { setEError(null); setExpModal(true); }} style={{
            borderRadius: "var(--r-md)", padding: "13px 16px",
            display: "flex", alignItems: "center", gap: 8,
            whiteSpace: "nowrap", border: "1px solid var(--line)", cursor: "pointer",
            fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600,
            background: "var(--surface)", color: "var(--ink)", flexShrink: 0,
          }}>
            Расход
          </button>
        </div>

        {/* Мои расходы · 30 дней */}
        <div style={{
          background: "var(--surface)", borderRadius: "var(--r-xl)",
          border: "1px solid var(--line)", padding: 16,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>Мои расходы · 30 дней</div>
            <div style={{
              fontSize: 34, fontWeight: 300, letterSpacing: "-0.025em",
              fontVariantNumeric: "tabular-nums", color: "var(--ink)",
              fontFamily: "var(--font-ui)",
            }}>
              {totalExpense > 0 ? totalExpense.toLocaleString("ru-RU") : "0"}
            </div>
          </div>

          {/* Sparkline */}
          <div style={{ display: "flex", gap: 3, height: 26, alignItems: "flex-end", marginTop: 8, marginBottom: 4 }}>
            {sparkData.map((v, i) => (
              <div key={i} style={{
                flex: 1,
                borderRadius: "2px 2px 0 0",
                height: `${Math.max(3, Math.round((v / sparkMax) * 26))}px`,
                background: i === 13 ? "var(--accent)" : "var(--bar)",
              }} />
            ))}
          </div>

          {myExpenses.length === 0 ? (
            <p style={{ color: "var(--text-3)", fontSize: 13, margin: "8px 0 0" }}>Нет записей за 30 дней</p>
          ) : (
            myExpenses.slice(0, 10).map(e => {
              let photos: string[] = [];
              try { photos = JSON.parse(e.photo_paths || "[]"); } catch { /* */ }
              return (
              <div key={e.id} style={{
                padding: "11px 0", borderTop: "1px solid var(--line-row)",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{e.category}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                    {fmtDate(e.date)}
                    {e.bank ? ` · ${e.bank}` : ""}
                    {e.truck_id && truckMap[e.truck_id] ? ` · ${truckMap[e.truck_id]}` : ""}
                  </div>
                </div>
                {photos.length > 0 && (
                  <a
                    href={fileUrl(`/photos/${photos[0]}`)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={ev => ev.stopPropagation()}
                    style={{
                      position: "relative", flexShrink: 0, width: 34, height: 34,
                      borderRadius: "var(--r-sm)", overflow: "hidden",
                      border: "1px solid var(--line)", display: "block",
                    }}
                  >
                    <img src={fileUrl(`/photos/${photos[0]}`)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    {photos.length > 1 && (
                      <span style={{
                        position: "absolute", right: 0, bottom: 0,
                        background: "var(--invert)", color: "var(--on-invert)",
                        fontSize: 9, fontWeight: 700, padding: "0 3px",
                        borderTopLeftRadius: 4, fontFamily: "var(--font-mono)",
                      }}>
                        {photos.length}
                      </span>
                    )}
                  </a>
                )}
                <div style={{
                  fontSize: 13, fontWeight: 500, color: "var(--ink)",
                  fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", flexShrink: 0,
                }}>
                  {money(e.expense)}
                </div>
              </div>
              );
            })
          )}
          {myExpenses.length > 10 && (
            <div style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center", marginTop: 6 }}>
              + ещё {myExpenses.length - 10} записей
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderFleet() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {trucks.length === 0 && (
          <p style={{ color: "var(--text-3)", textAlign: "center" }}>Нет данных</p>
        )}
        {trucks.map(t => {
          const osagoD = daysLeft(t.osago_date);
          const techD  = daysLeft(t.tech_inspection_date);
          const kaskoD = daysLeft(t.kasko_date);
          const sess = activeSessions.get(t.id);

          // Status chip
          const hasExpired = [osagoD, techD, kaskoD].some(d => d !== null && d <= 7);
          const statusLabel = sess ? "В рейсе" : hasExpired ? "Требует внимания" : "Свободна";
          const statusBg = sess ? "var(--success-bg)" : hasExpired ? "var(--danger-bg)" : "var(--surface-2)";
          const statusColor = sess ? "var(--success)" : hasExpired ? "var(--danger)" : "var(--text-2)";

          return (
            <div key={t.id} style={{
              background: "var(--surface)", border: "1px solid var(--line)",
              borderRadius: "var(--r-xl)", padding: "14px 15px", cursor: "pointer",
            }} onClick={() => setSelectedTruck(t)}>
              {/* Head row */}
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{
                  width: 40, height: 40, borderRadius: "var(--r-lg)",
                  background: "var(--surface-2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500,
                  color: "var(--ink)", flexShrink: 0,
                }}>
                  {t.plate.slice(0, 2)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--ink)" }}>
                    {t.plate}
                  </div>
                  {t.brand && (
                    <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{t.brand}{t.year ? ` · ${t.year}` : ""}</div>
                  )}
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "4px 9px",
                  borderRadius: "var(--r-xs)", background: statusBg, color: statusColor,
                  flexShrink: 0,
                }}>
                  {statusLabel}
                </span>
              </div>

              {/* Doc chips */}
              <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                {[
                  { label: "ОСАГО", days: osagoD, date: t.osago_date },
                  { label: "ТО", days: techD, date: t.tech_inspection_date },
                  { label: "КАСКО", days: kaskoD, date: t.kasko_date },
                ].filter(d => d.date).map(d => (
                  <span key={d.label} style={{
                    fontSize: 10.5, fontWeight: 500, fontFamily: "var(--font-mono)",
                    padding: "5px 8px", borderRadius: 7,
                    background: docBg(d.days), color: docColor(d.days),
                  }}>
                    {d.label} {fmtDate(d.date)}
                  </span>
                ))}
              </div>

              {/* Stats row */}
              {(() => {
                const stats = getTruckToStats(t.id, t.maintenance_interval_km, mileages);
                if (!stats) return null;
                const col = stats.kmSince != null ? toKmColor(stats.kmSince) : "var(--text-3)";
                return (
                  <div style={{
                    paddingTop: 12, borderTop: "1px solid var(--line-row)",
                    display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap",
                  }}>
                    <div>
                      <div style={{ fontSize: 9.5, fontWeight: 500, textTransform: "uppercase", letterSpacing: ".07em", fontFamily: "var(--font-mono)", color: "var(--text-4)", marginBottom: 4 }}>Одометр</div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>{stats.lastOdometer.toLocaleString("ru-RU")} км</div>
                    </div>
                    {stats.kmSince != null && (
                      <div>
                        <div style={{ fontSize: 9.5, fontWeight: 500, textTransform: "uppercase", letterSpacing: ".07em", fontFamily: "var(--font-mono)", color: "var(--text-4)", marginBottom: 4 }}>С ТО</div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: col }}>{stats.kmSince.toLocaleString("ru-RU")} км</div>
                      </div>
                    )}
                    {stats.remaining != null && (
                      <div>
                        <div style={{ fontSize: 9.5, fontWeight: 500, textTransform: "uppercase", letterSpacing: ".07em", fontFamily: "var(--font-mono)", color: "var(--text-4)", marginBottom: 4 }}>До ТО</div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: col }}>
                          {stats.remaining >= 0
                            ? `${stats.remaining.toLocaleString("ru-RU")} км`
                            : `−${Math.abs(stats.remaining).toLocaleString("ru-RU")} км`}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Active session */}
              {sess && (
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); openFleetSession(sess.session_id); }}
                  style={{
                    marginTop: 10, background: "var(--success-bg)",
                    border: "1px solid var(--success)", borderRadius: "var(--r-md)",
                    padding: "8px 12px", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 8,
                    fontFamily: "var(--font-ui)", width: "100%", textAlign: "left",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--success)" }}>{sess.driver_name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-2)" }}>с {fmtDate(sess.started_at)} · нажмите для акта П/П</div>
                  </div>
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function renderTeam() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {drivers.filter(d => d.active).map(d => {
          const initials = d.name.split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("");
          return (
            <div key={d.id} style={{
              background: "var(--surface)", borderRadius: "var(--r-xl)",
              border: "1px solid var(--line)", padding: "13px 14px",
              display: "flex", gap: 12, alignItems: "center", cursor: "pointer",
            }} onClick={() => openDriverDetail(d)}>
              {/* Avatar */}
              <div style={{
                width: 38, height: 38, borderRadius: "50%",
                background: "var(--accent)", color: "var(--on-accent)",
                fontWeight: 600, fontSize: 13,
                display: "grid", placeItems: "center", flexShrink: 0,
              }}>
                {initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{d.name}</span>
                  {d.role === "foreman" && (
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: "3px 8px",
                      borderRadius: "var(--r-xs)", background: "var(--surface-2)", color: "var(--text-2)",
                    }}>Бригадир</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                  {d.truck_plate ? d.truck_plate : ""}
                  {d.phone && d.truck_plate ? " · " : ""}
                  {d.phone}
                </div>
              </div>
              {d.phone && (
                <a href={`tel:${d.phone}`} onClick={e => e.stopPropagation()} style={{
                  width: 36, height: 36, borderRadius: "var(--r-sm)",
                  background: "var(--surface-2)", color: "var(--ink)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  textDecoration: "none", flexShrink: 0,
                }}>
                  <IconPhone size={16} />
                </a>
              )}
            </div>
          );
        })}
        {drivers.filter(d => !d.active).length > 0 && (
          <p style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center", margin: "4px 0 0" }}>
            Неактивных: {drivers.filter(d => !d.active).length}
          </p>
        )}
      </div>
    );
  }

  function renderTrips() {
    return (
      <div>
        {/* Tabs */}
        <div style={{
          display: "flex", gap: 6, padding: 3,
          borderRadius: "var(--r-xl)", background: "var(--surface)",
          border: "1px solid var(--line-strong)", marginBottom: 12,
        }}>
          <button type="button" style={tabStyle(tripsTab === "list")} onClick={() => setTripsTab("list")}>
            Рейсы
          </button>
          <button type="button" style={tabStyle(tripsTab === "mileage")} onClick={() => setTripsTab("mileage")}>
            Пробеги
          </button>
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
              <div style={{
                background: "var(--surface)", borderRadius: "var(--r-xl)",
                border: "1px solid var(--line)", padding: "12px 14px", marginBottom: 4,
              }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 3 }}>С</div>
                    <input type="date" style={{ ...inputSt, padding: "8px 10px", fontSize: 13 }}
                      value={tripFrom} onChange={e => setTripFrom(e.target.value)} />
                  </div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 3 }}>По</div>
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
                    marginTop: 8, width: "100%", border: "none", borderRadius: "var(--r-sm)",
                    padding: "7px 0", fontSize: 12, fontFamily: "var(--font-ui)",
                    cursor: "pointer", background: "var(--surface-2)", color: "var(--text-2)",
                  }}>
                    Сбросить фильтры · {filteredTrips.length} из {trips.length}
                  </button>
                )}
              </div>

              {filteredTrips.length === 0 && (
                <p style={{ color: "var(--text-3)", textAlign: "center" }}>Нет рейсов</p>
              )}
              {filteredTrips.map(t => {
                const isOpen = expandedTrips.has(t.id);
                return (
                  <div key={t.id} style={{
                    background: "var(--surface)", borderRadius: "var(--r-xl)",
                    border: "1px solid var(--line)", padding: "14px 15px",
                    cursor: "pointer", marginBottom: 0,
                  }} onClick={() => toggleTrip(t.id)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                          {t.source} — {t.request_number}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                          {fmtDate(t.dep_at)}
                          {t.driver_id && driverMap[t.driver_id] ? ` · ${driverMap[t.driver_id]}` : ""}
                          {t.truck_id && truckMap[t.truck_id] ? ` · ${truckMap[t.truck_id]}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                            {money(t.amount)}
                          </div>
                          {t.fines > 0 && (
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--danger)", marginTop: 1 }}>
                              штраф −{money(t.fines)}
                            </div>
                          )}
                          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{t.status}</div>
                        </div>
                        <div style={{ transition: "transform 200ms", transform: isOpen ? "rotate(180deg)" : "none", color: "var(--text-3)" }}>
                          <IconChevronDown size={16} />
                        </div>
                      </div>
                    </div>

                    {isOpen && (
                      <div style={{
                        marginTop: 12, paddingTop: 12,
                        borderTop: "1px solid var(--line-row)",
                        display: "grid", gridTemplateColumns: "1fr 1fr",
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
                            valueStyle={{ color: "var(--danger)", fontWeight: 600 }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {tripsTab === "mileage" && (
          <div>
            {!showMileageForm ? (
              <button type="button" onClick={() => setShowMileageForm(true)} style={{
                width: "100%", border: "2px dashed var(--line-strong)",
                borderRadius: "var(--r-xl)", padding: "14px 0",
                fontSize: 14, fontWeight: 700, fontFamily: "var(--font-ui)",
                cursor: "pointer", background: "var(--surface-2)", color: "var(--text-2)",
                marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                <IconPlus size={16} /> Добавить пробег
              </button>
            ) : (
              <div style={{
                background: "var(--surface)", borderRadius: "var(--r-xl)",
                border: "1px solid var(--line)", padding: "14px 15px", marginBottom: 14,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>Внести пробег</div>
                  <button type="button" onClick={() => setShowMileageForm(false)} style={{
                    background: "var(--surface-2)", border: "none", borderRadius: "var(--r-sm)",
                    width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", color: "var(--text-2)",
                  }}>
                    <IconClose size={14} />
                  </button>
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
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink)" }}>
                    <input type="checkbox" checked={mIsService} onChange={e => setMIsService(e.target.checked)} />
                    ТО / сервис
                  </label>
                  {formError && <p style={{ color: "var(--danger)", fontSize: 12, margin: 0 }}>{formError}</p>}
                  <button type="button" onClick={submitMileage} disabled={saving} style={{
                    background: "var(--invert)", color: "var(--on-invert)", border: "none",
                    borderRadius: "var(--r-md)", padding: "12px 0", fontSize: 14,
                    fontWeight: 700, fontFamily: "var(--font-ui)",
                    cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
                  }}>
                    {saving ? "Сохраняем..." : "Сохранить пробег"}
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {mileages.map(m => (
                <div key={m.id} style={{
                  background: "var(--surface)", borderRadius: "var(--r-xl)",
                  border: "1px solid var(--line)", padding: "14px 15px",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }}>
                        {truckMap[m.truck_id] ?? `#${m.truck_id}`}
                        {m.is_service && (
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: "var(--r-xs)", background: "var(--warn-bg)", color: "var(--warn)" }}>ТО</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                        {fmtDate(m.date)}
                        {m.driver_id && driverMap[m.driver_id] ? ` · ${driverMap[m.driver_id]}` : ""}
                      </div>
                      {m.note && <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{m.note}</div>}
                    </div>
                    {m.odometer != null && (
                      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", fontFamily: "var(--font-mono)" }}>
                        {m.odometer.toLocaleString("ru-RU")} км
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderRequests() {
    const repairStatusStyle = (status: string): CSSProperties => {
      if (status === "создана") return { background: "var(--warn-bg)", color: "var(--warn)" };
      if (status === "в работе") return { background: "var(--success-bg)", color: "var(--success)" };
      return { background: "var(--surface-2)", color: "var(--text-3)" };
    };

    const compStatusStyle = (status: string): CSSProperties => {
      if (status === "принято") return { background: "var(--success-bg)", color: "var(--success)" };
      if (status === "отказано") return { background: "var(--danger-bg)", color: "var(--danger)" };
      return { background: "var(--warn-bg)", color: "var(--warn)" };
    };

    return (
      <div>
        {/* Tabs */}
        <div style={{
          display: "flex", gap: 6, padding: 3,
          borderRadius: "var(--r-xl)", background: "var(--surface)",
          border: "1px solid var(--line-strong)", marginBottom: 12,
        }}>
          <button type="button" style={tabStyle(reqTab === "repairs")} onClick={() => setReqTab("repairs")}>
            Ремонт
          </button>
          <button type="button" style={tabStyle(reqTab === "comps")} onClick={() => setReqTab("comps")}>
            Компенсации
          </button>
        </div>

        {reqTab === "repairs" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {repairs.length === 0 && <p style={{ color: "var(--text-3)", textAlign: "center" }}>Нет заявок</p>}
            {repairs.map(r => (
              <div key={r.id} style={{
                background: "var(--surface)", borderRadius: "var(--r-xl)",
                border: "1px solid var(--line)", padding: "14px 15px", marginBottom: 8,
              }}>
                {/* Header row */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--ink)" }}>
                      {r.truck_label !== "—" ? r.truck_label : ""}
                    </span>
                    {r.priority === "срочная" && (
                      <span style={{
                        fontSize: 9.5, fontWeight: 600, padding: "3px 6px",
                        borderRadius: 6, background: "var(--danger-bg)", color: "var(--danger)",
                        fontFamily: "var(--font-mono)",
                      }}>СРОЧНО</span>
                    )}
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "4px 9px",
                    borderRadius: "var(--r-xs)", ...repairStatusStyle(r.status),
                  }}>
                    {r.status}
                  </span>
                </div>

                <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)", marginTop: 6 }}>{r.text}</div>
                <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-3)", marginTop: 4 }}>
                  {r.driver_name !== "—" ? r.driver_name : ""}
                  {r.driver_name !== "—" && r.created_at ? " · " : ""}
                  {fmtDate(r.created_at)}
                </div>

                {r.close_comment && (
                  <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 4, fontStyle: "italic" }}>
                    {r.close_comment}
                  </div>
                )}

                {/* Actions */}
                {r.status === "создана" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button type="button"
                      onClick={() => changeRepairStatus(r.id, "в работе")}
                      style={{
                        flex: 1, background: "var(--invert)", color: "var(--on-invert)",
                        border: "none", borderRadius: "var(--r-md)", padding: 12,
                        fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-ui)",
                      }}>
                      Взять в работу
                    </button>
                  </div>
                )}

                {r.status === "в работе" && (
                  closeId === r.id ? (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                      <input type="text" placeholder="Комментарий (необязательно)" style={inputSt}
                        value={closeComment} onChange={e => setCloseComment(e.target.value)} />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" onClick={() => setCloseId(null)} style={{
                          flex: 1, border: "none", borderRadius: "var(--r-md)", padding: "9px 0",
                          fontSize: 13, fontFamily: "var(--font-ui)", cursor: "pointer",
                          background: "var(--surface-2)", color: "var(--text-2)",
                        }}>Отмена</button>
                        <button type="button" onClick={closeRepair} disabled={closeSaving} style={{
                          flex: 2, border: "none", borderRadius: "var(--r-md)", padding: "9px 0",
                          fontSize: 13, fontWeight: 600, fontFamily: "var(--font-ui)", cursor: "pointer",
                          background: "var(--success)", color: "#fff", opacity: closeSaving ? 0.6 : 1,
                        }}>
                          {closeSaving ? "Сохраняем..." : "Закрыть заявку"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button type="button"
                        onClick={() => { setCloseId(r.id); setCloseComment(""); }}
                        style={{
                          flex: 1, background: "var(--invert)", color: "var(--on-invert)",
                          border: "none", borderRadius: "var(--r-md)", padding: 12,
                          fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-ui)",
                        }}>
                        Закрыть заявку
                      </button>
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        )}

        {reqTab === "comps" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {comps.length === 0 && <p style={{ color: "var(--text-3)", textAlign: "center" }}>Нет заявок</p>}
            {comps.map(c => (
              <div key={c.id} style={{
                background: "var(--surface)", borderRadius: "var(--r-xl)",
                border: "1px solid var(--line)", padding: "14px 15px", marginBottom: 8,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500, fontFamily: "var(--font-mono)", color: "var(--ink)" }}>
                    {c.truck_label !== "—" ? c.truck_label : ""}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "4px 9px",
                    borderRadius: "var(--r-xs)", ...compStatusStyle(c.status),
                  }}>
                    {c.status}
                  </span>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--ink)", marginTop: 6 }}>{c.category}</div>
                {c.description && (
                  <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>{c.description}</div>
                )}
                <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-3)", marginTop: 4 }}>
                  {c.driver_name} · {fmtDate(c.expense_date)}
                </div>
                {c.reject_reason && (
                  <div style={{ fontSize: 12, color: "var(--danger)", marginTop: 4 }}>
                    Причина отказа: {c.reject_reason}
                  </div>
                )}
                <div style={{
                  marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line-row)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>СУММА</span>
                  <span style={{
                    fontSize: 15, fontWeight: 500, color: "var(--ink)",
                    fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
                  }}>
                    {money(c.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─ Полный чеклист акта П/П ───────────────────────────────────────────────
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
            <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--font-mono)", marginBottom: 3 }}>
              Блок {blockNum}
            </div>
            {items.map(item => {
              const ok  = item.status === "yes";
              const bad = item.status === "no";
              const color = bad ? "var(--danger)" : ok ? "var(--success)" : "var(--text-3)";
              const icon  = bad ? "✗" : ok ? "✓" : "—";
              return (
                <div key={item.id} style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "4px 0", borderBottom: "1px solid var(--line-row)",
                  opacity: (!item.status || item.status === "na") ? 0.45 : 1,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color, minWidth: 14, flexShrink: 0 }}>{icon}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 12, color: "var(--ink)" }}>{item.label}</span>
                    {item.item_count != null && (
                      <span style={{ fontSize: 11, color: "var(--text-3)" }}> ×{item.item_count}</span>
                    )}
                    {item.note && (
                      <div style={{ fontSize: 11, color: bad ? "var(--danger)" : "var(--text-3)", marginTop: 1 }}>{item.note}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {realDamages.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--font-mono)", marginBottom: 3 }}>Повреждения</div>
            {realDamages.map(d => (
              <div key={d.id} style={{ fontSize: 12, color: "var(--warn)", padding: "3px 0" }}>
                {d.description}
                {d.photo_path && (
                  <a href={fileUrl(`/photos/${d.photo_path}`)} target="_blank" rel="noreferrer"
                    style={{ marginLeft: 6, color: "var(--accent-ink)" }}>
                    <IconCamera size={12} />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─ Навигация ─────────────────────────────────────────────────────────────
  const alertCount = (attention?.expiring_docs.length ?? 0)
    + (attention?.open_repairs_count ?? 0)
    + (attention?.pending_comps_count ?? 0);
  const reqAlertCount = (attention?.open_repairs_count ?? 0) + (attention?.pending_comps_count ?? 0);

  const NAV: { id: Section; icon: React.ReactNode; label: string }[] = [
    { id: "home",     icon: <IconDashboard size={18} />, label: "Главная" },
    { id: "fleet",    icon: <IconTruck size={18} />,     label: "Парк" },
    { id: "team",     icon: <IconDrivers size={18} />,   label: "Команда" },
    { id: "trips",    icon: <IconTrips size={18} />,     label: "Рейсы" },
    { id: "requests", icon: <IconRepairs size={18} />,   label: "Заявки" },
  ];

  const nameStr = user?.full_name || user?.username || "Б";
  const initials = nameStr.split(" ").map((w: string) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  // ─ JSX ───────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100dvh",
      background: "var(--bg)",
      color: "var(--ink)",
      fontFamily: "var(--font-ui)",
      maxWidth: 480,
      margin: "0 auto",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Хедер */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "var(--bg)",
        padding: "max(env(safe-area-inset-top,0px),14px) 16px 14px",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: "50%",
          background: "var(--accent)", color: "var(--on-accent)",
          fontWeight: 600, fontSize: 13,
          display: "grid", placeItems: "center", flexShrink: 0,
        }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 16, fontWeight: 600, letterSpacing: -0.3,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: "var(--ink)",
          }}>
            {nameStr}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)", marginTop: 1 }}>
            бригадир
          </div>
        </div>
        {user?.driver_id && (
          <button type="button" onClick={() => navigate("/driver")} style={{
            background: "var(--invert)", color: "var(--on-invert)",
            border: "none", borderRadius: "var(--r-md)", padding: "8px 14px",
            fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-ui)",
            flexShrink: 0, letterSpacing: -0.1,
          }}>
            Водитель
          </button>
        )}
      </div>

      {/* Контент */}
      <div style={{ flex: 1, padding: "16px 14px 0", overflow: "visible" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "var(--text-3)", paddingTop: 48, fontSize: 14 }}>
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
        {/* Spacer for bottom nav */}
        <div style={{ height: 80 }} />
      </div>

      {/* Нижняя навигация */}
      <nav style={{
        position: "sticky", bottom: 0, zIndex: 100,
        background: "var(--surface)", borderTop: "1px solid var(--line)",
        padding: "8px 6px max(env(safe-area-inset-bottom,0px),12px)",
        display: "flex",
      }}>
        {NAV.map(n => (
          <button key={n.id} type="button" onClick={() => setSection(n.id)} style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
            padding: "6px 2px", border: "none", background: "none", cursor: "pointer",
            position: "relative", fontFamily: "var(--font-ui)",
            color: section === n.id ? "var(--ink)" : "var(--text-3)",
          }}>
            {n.icon}
            <span style={{ fontSize: 10.5, fontWeight: 600, color: "inherit" }}>{n.label}</span>
            {n.id === "home" && alertCount > 0 && (
              <span style={{
                position: "absolute", top: 2, right: 16,
                minWidth: 15, height: 15, borderRadius: 8,
                background: "var(--danger-dot)", color: "#fff",
                fontSize: 9, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {alertCount > 9 ? "9+" : alertCount}
              </span>
            )}
            {n.id === "requests" && reqAlertCount > 0 && (
              <span style={{
                position: "absolute", top: 2, right: 16,
                minWidth: 15, height: 15, borderRadius: 8,
                background: "var(--danger-dot)", color: "#fff",
                fontSize: 9, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {reqAlertCount > 9 ? "9+" : reqAlertCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Sheet: Заявка на ремонт */}
      {modal === "repair" && (
        <Sheet
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
                flex: 1, border: "none", borderRadius: "var(--r-md)", padding: "10px 0",
                fontSize: 13, fontWeight: 600, fontFamily: "var(--font-ui)", cursor: "pointer",
                background: rPriority === p
                  ? (p === "срочная" ? "var(--danger)" : "var(--invert)")
                  : "var(--surface-2)",
                color: rPriority === p ? "#fff" : "var(--text-2)",
              }}>
                {p === "срочная" ? "Срочная" : "Обычная"}
              </button>
            ))}
          </div>
          <textarea
            placeholder="Описание неисправности *"
            style={{ ...inputSt, minHeight: 90, resize: "vertical" }}
            value={rText}
            onChange={e => setRText(e.target.value)}
          />
        </Sheet>
      )}

      {/* Sheet: Пробег */}
      {modal === "mileage" && (
        <Sheet
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
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink)" }}>
            <input type="checkbox" checked={mIsService} onChange={e => setMIsService(e.target.checked)} />
            ТО / сервисное обслуживание
          </label>
        </Sheet>
      )}

      {/* Sheet: Карточка машины */}
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
            position: "fixed", inset: 0, background: "var(--overlay)",
            zIndex: 200, display: "flex", alignItems: "flex-end",
          }} onClick={() => setSelectedTruck(null)}>
            <div style={{
              background: "var(--surface)", borderRadius: "var(--r-sheet) var(--r-sheet) 0 0",
              width: "100%", maxWidth: 480, margin: "0 auto",
              maxHeight: "88vh", overflow: "auto",
              padding: "20px 18px",
              paddingBottom: "max(env(safe-area-inset-bottom,0px),28px)",
            }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
                <span style={{ flex: 1, fontWeight: 700, fontSize: 16, color: "var(--ink)" }}>{t.plate}</span>
                <button type="button" onClick={() => setSelectedTruck(null)} style={{
                  background: "var(--surface-2)", border: "none", borderRadius: "var(--r-sm)",
                  width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "var(--text-2)",
                }}>
                  <IconClose size={16} />
                </button>
              </div>

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
                    <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>{r.l}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginTop: 2 }}>{r.v}</div>
                  </div>
                ))}
              </div>

              {docs.length > 0 && (
                <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: ".07em", fontFamily: "var(--font-mono)", fontWeight: 600, marginBottom: 8 }}>ДОКУМЕНТЫ</div>
                  {docs.map(d => {
                    const days = daysLeft(d.date);
                    const col = docColor(days);
                    return (
                      <div key={d.label} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                        padding: "7px 0", borderBottom: "1px solid var(--line-row)",
                      }}>
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{d.label}</span>
                          {d.number && <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>{d.number}</div>}
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
                <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-2)", fontStyle: "italic" }}>{t.notes}</div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Sheet: Карточка водителя */}
      {selectedDriver && (() => {
        const d = selectedDriver;
        const det = driverDetail;
        const fio = [det?.last_name, det?.first_name, det?.middle_name].filter(Boolean).join(" ") || d.name;
        return (
          <div style={{
            position: "fixed", inset: 0, background: "var(--overlay)",
            zIndex: 200, display: "flex", alignItems: "flex-end",
          }} onClick={() => setSelectedDriver(null)}>
            <div style={{
              background: "var(--surface)", borderRadius: "var(--r-sheet) var(--r-sheet) 0 0",
              width: "100%", maxWidth: 480, margin: "0 auto",
              maxHeight: "88vh", overflow: "auto",
              padding: "20px 18px",
              paddingBottom: "max(env(safe-area-inset-bottom,0px),28px)",
            }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
                <span style={{ flex: 1, fontWeight: 700, fontSize: 16, color: "var(--ink)" }}>{fio}</span>
                <button type="button" onClick={() => setSelectedDriver(null)} style={{
                  background: "var(--surface-2)", border: "none", borderRadius: "var(--r-sm)",
                  width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "var(--text-2)",
                }}>
                  <IconClose size={16} />
                </button>
              </div>

              <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                {d.role === "foreman" && (
                  <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: "var(--r-xs)", background: "var(--surface-2)", color: "var(--text-2)" }}>Бригадир</span>
                )}
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: "var(--r-xs)",
                  background: d.active ? "var(--success-bg)" : "var(--surface-2)",
                  color: d.active ? "var(--success)" : "var(--text-3)",
                }}>
                  {d.active ? "Активен" : "Неактивен"}
                </span>
              </div>

              {driverDetailLoading && (
                <p style={{ color: "var(--text-3)", fontSize: 13, textAlign: "center" }}>Загрузка данных...</p>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                {[
                  { l: "Телефон", v: d.phone },
                  { l: "Email", v: d.email },
                  { l: "Машина", v: d.truck_plate },
                  { l: "Дата рождения", v: det ? fmtDate(det.birth_date) : "" },
                ].filter(r => r.v && r.v !== "—").map(r => (
                  <div key={r.l}>
                    <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>{r.l}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginTop: 2 }}>
                      {r.l === "Телефон"
                        ? <a href={`tel:${r.v}`} style={{ color: "var(--accent-ink)", textDecoration: "none" }}>{r.v}</a>
                        : r.v}
                    </div>
                  </div>
                ))}
              </div>

              {det && (det.license_number || det.license_valid_until) && (
                <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: ".07em", fontFamily: "var(--font-mono)", fontWeight: 600, marginBottom: 8 }}>ВОДИТЕЛЬСКОЕ УДОСТОВЕРЕНИЕ</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {det.license_number && (
                      <div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>Серия / Номер</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginTop: 2 }}>{det.license_number}</div>
                      </div>
                    )}
                    {det.license_valid_until && (() => {
                      const days = daysLeft(det.license_valid_until);
                      const col = docColor(days);
                      return (
                        <div>
                          <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>Действ. до</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: col, marginTop: 2 }}>
                            {fmtDate(det.license_valid_until)}
                            {days !== null && days <= 30 && (
                              <span style={{ fontSize: 11, marginLeft: 4 }}>
                                ({days < 0 ? "просрочено" : `${days} дн.`})
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
                <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                  <div style={{ fontSize: 11, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: ".07em", fontFamily: "var(--font-mono)", fontWeight: 600, marginBottom: 8 }}>КАРТА СКЗИ</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {det.skzi_card_number && (
                      <div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>Номер</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginTop: 2 }}>{det.skzi_card_number}</div>
                      </div>
                    )}
                    {det.skzi_valid_until && (() => {
                      const days = daysLeft(det.skzi_valid_until);
                      const col = docColor(days);
                      return (
                        <div>
                          <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>Действ. до</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: col, marginTop: 2 }}>
                            {fmtDate(det.skzi_valid_until)}
                            {days !== null && days <= 30 && (
                              <span style={{ fontSize: 11, marginLeft: 4 }}>
                                ({days < 0 ? "просрочено" : `${days} дн.`})
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
                <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-2)", fontStyle: "italic" }}>{det.notes}</div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Sheet: Добавить расход */}
      {expModal && (
        <Sheet
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
            type="number" inputMode="decimal" placeholder="Сумма (₽) *"
            style={inputSt} value={eAmount} onChange={e => setEAmount(e.target.value)}
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
            type="text" placeholder="Назначение (необязательно)"
            style={inputSt} value={ePurpose} onChange={e => setEPurpose(e.target.value)}
          />

          {/* Фото чека */}
          <div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 6 }}>Фото чека</div>
            <label style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              width: "100%", padding: "11px 0", borderRadius: "var(--r-md)",
              border: `2px dashed ${eUploading ? "var(--accent-ink)" : "var(--line-strong)"}`,
              cursor: eUploading ? "default" : "pointer",
              background: eUploading ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "var(--surface-2)",
              color: eUploading ? "var(--accent-ink)" : "var(--text-3)",
              fontSize: 13, fontFamily: "var(--font-ui)", boxSizing: "border-box",
              transition: "all .15s ease",
            }}>
              <input
                type="file" accept="image/*" multiple disabled={eUploading}
                style={{ display: "none" }}
                onChange={async e => {
                  const files = Array.from(e.target.files ?? []);
                  for (const f of files) await uploadExpensePhoto(f);
                  e.target.value = "";
                }}
              />
              <IconCamera size={16} />
              {eUploading ? "Загрузка..." : "Прикрепить фото чека"}
            </label>
            {ePhotos.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {ePhotos.map((f, i) => (
                  <div key={f} style={{ position: "relative" }}>
                    <img
                      src={fileUrl(`/photos/${f}`)}
                      style={{
                        width: 72, height: 72, objectFit: "cover",
                        borderRadius: "var(--r-md)", border: "1px solid var(--line)",
                        display: "block",
                      }}
                      alt="чек"
                    />
                    <button
                      type="button"
                      onClick={() => setEPhotos(prev => prev.filter((_, j) => j !== i))}
                      style={{
                        position: "absolute", top: -6, right: -6,
                        background: "var(--danger)", color: "#fff",
                        border: "none", borderRadius: "50%",
                        width: 20, height: 20, fontSize: 11,
                        cursor: "pointer", lineHeight: 1,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        padding: 0, fontWeight: 700,
                      }}
                    >
                      <IconClose size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Sheet>
      )}

      {/* Sheet: Акт приёмки-сдачи (флот) */}
      {fleetSessionId !== null && (
        <Sheet title="Акт приёмки-сдачи" onClose={() => { setFleetSessionId(null); setFleetSessDetail(null); }}>
          {fleetSessLoading && <p style={{ color: "var(--text-3)", fontSize: 13, textAlign: "center" }}>Загрузка...</p>}
          {fleetSessDetail && (() => {
            const det = fleetSessDetail;
            return (
              <>
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
                  padding: "10px 12px", background: "var(--surface-2)", borderRadius: "var(--r-md)",
                }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>Водитель</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{det.driver_name}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>Машина</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{det.truck_plate}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>Принята</div>
                    <div style={{ fontSize: 12, color: "var(--ink)" }}>{fmtDateTime(det.started_at)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>Сдана</div>
                    <div style={{ fontSize: 12, color: det.ended_at ? "var(--ink)" : "var(--success)", fontWeight: det.ended_at ? 400 : 700 }}>
                      {det.ended_at ? fmtDateTime(det.ended_at) : "В пути"}
                    </div>
                  </div>
                </div>

                {(det.start_inspection?.odometer != null || det.end_inspection?.odometer != null) && (
                  <div style={{ display: "flex", gap: 8 }}>
                    {det.start_inspection?.odometer != null && (
                      <div style={{ flex: 1, padding: "8px 10px", background: "var(--success-bg)", borderRadius: "var(--r-md)", border: "1px solid var(--success)" }}>
                        <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>При приёмке</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--success)" }}>{det.start_inspection.odometer.toLocaleString("ru-RU")} км</div>
                      </div>
                    )}
                    {det.end_inspection?.odometer != null && (
                      <div style={{ flex: 1, padding: "8px 10px", background: "var(--surface-2)", borderRadius: "var(--r-md)", border: "1px solid var(--line)" }}>
                        <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>При сдаче</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>{det.end_inspection.odometer.toLocaleString("ru-RU")} км</div>
                      </div>
                    )}
                  </div>
                )}

                {det.start_inspection && renderInspFull(det.start_inspection, "var(--success)", "Приёмка")}
                {det.end_inspection && renderInspFull(det.end_inspection, "var(--accent-ink)", "Сдача")}
                {!det.start_inspection && !det.end_inspection && (
                  <p style={{ color: "var(--text-3)", fontSize: 13, textAlign: "center" }}>Актов нет</p>
                )}
              </>
            );
          })()}
        </Sheet>
      )}
    </div>
  );
}
