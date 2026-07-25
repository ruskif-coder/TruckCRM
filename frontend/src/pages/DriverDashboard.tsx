/**
 * Мобильный дашборд водителя — редизайн 2026-07-01.
 * Стиль: светлые карточки на сером фоне, акцент --iris.
 * Логика и API не изменились.
 *
 * 2026-07-02: добавлена полная форма приёмки-передачи авто (4 блока).
 */
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import imageCompression from "browser-image-compression";
import { api, ApiError, fileUrl } from "../api";
import { useAuth } from "../auth/AuthContext";
import { isoDate, money } from "../lib/format";

async function compressPhoto(file: File): Promise<File> {
  return imageCompression(file, { maxSizeMB: 1.5, maxWidthOrHeight: 1920, useWebWorker: true });
}

// ---------- Типы ----------
type Summary = {
  driver_id: number | null;
  driver_name: string;
  balance: number;
  as_of: string | null;
  last_week_trips: number;
  last_week_payout: number;
  last_week_cancelled: number;
  last_week_cancelled_fines: number;
  last_week_start: string | null;
};
type DriverTx = {
  id: number;
  date: string;
  tx_type: string;
  amount: number;
  description: string;
};
type TxData = {
  balance_adjustment: number;
  transactions: DriverTx[];
};
// Полная выписка: начисления/выплаты из weekly_pnl + DriverTransaction
type LedgerEntry = {
  date: string;
  entry_type: string; // pnl_accrual | pnl_payment | compensation | advance | fine_pdd | fine_company
  amount: number;
  description: string;
};
type Truck = { id: number; label: string; plate: string }
type PaymentTerm = { carrier: string; rate_type: string; rate_value: number }
type ProfileData = {
  last_name: string;
  first_name: string;
  middle_name: string;
  passport_number: string;
  passport_issued_date: string | null;
  license_number: string;
  license_issued_date: string | null;
  license_valid_until: string | null;
  skzi_card_number: string;
  skzi_valid_until: string | null;
  payment_terms: PaymentTerm[];
};
type ActiveSession = {
  session_id: number;
  truck_id: number;
  truck_label: string;
  truck_plate: string;
  started_at: string;
} | null;
type ActiveSessionEntry = { truck_id: number; driver_name: string };
// ---------- Сводка по машине ----------
type TruckDoc = { number: string; date: string | null; scan_path: string | null };
type TruckInfo = {
  plate: string; label: string; brand: string; year: number | null;
  body_type: string; vin: string;
  sts: TruckDoc;
  osago: TruckDoc;
  tech_inspection: TruckDoc;
};

// ---------- Пункт чеклиста ----------
type CheckItem = { label: string; status: "yes" | "no" | ""; note: string; count?: number; photoPath?: string; photoUploading?: boolean };
// ---------- Повреждение ----------
type DamageEntry = { id: string; description: string; photoFile?: File; photoPath?: string };
// ---------- Чистота (блок 4) ----------
type CleanItem = { label: string; status: "" | "clean" | "medium" | "dirty"; photoPath?: string; uploading?: boolean };
// ---------- Фото 4 сторон ----------
type SidePhoto = { key: string; label: string; photoPath?: string; uploading?: boolean };
// ---------- Такелаж (блок 5) ----------
type RiggingItem = { label: string; status: "yes" | "no" | ""; qty: string };

const EXPENSE_CATEGORIES = [
  "Ремонт/запчасти",
  "Топливо",
  "Зарплата",
  "Страховка",
  "Прочее",
];

const BLOCK1_LABELS = [
  "Фары передние", "Фары задние", "Шины передние",
  "Шины задние", "Уровень масла", "Охлаждающая жидкость",
];
const BLOCK2_LABELS = [
  "СТС", "ОСАГО", "Карта ТехОсмотра", "Топливная карта", "Путевые листы",
];
const DEFAULT_EQUIPMENT = [
  "Автономка", "Домкрат", "Монтажка", "Ключ балонный",
  "Набор инструментов", "Спецовка", "Холодильник",
];

function makeItems(labels: string[]): CheckItem[] {
  return labels.map(label => ({ label, status: "", note: "" }));
}

// ---------- Вспомогательные ----------
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
}
function fmtShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}
function weekLabel(startIso: string | null, endIso?: string | null): string {
  if (!startIso) return "—";
  return `${fmtShort(startIso)} – ${fmtShort(endIso ?? startIso)}`;
}

// ---------- Иконка документа ----------
function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}

// ---------- CSS-токены (светлая тема, standalone) ----------
const C = {
  bg:         "#f0f1f5",
  card:       "#ffffff",
  cardShadow: "0 2px 12px rgba(0,0,0,.07)",
  border:     "#e8e9ee",
  ink:        "#111111",
  ink2:       "#6b6e7a",
  iris:       "var(--iris, #5683da)",
  irisLight:  "rgba(86,131,218,.10)",
  dark:       "#1a1a1e",
  good:       "#27ae60",
  warn:       "#d99a3a",
  radius:     16,
};

// ---------- Главный компонент ----------
export default function DriverDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSession>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modal, setModal] = useState<
    "mileage" | "expense" | "repair" | "handover" | "weekly" | "profile" | "changepass" | "truckinfo" | "instruction" | null
  >(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [truckInfo, setTruckInfo] = useState<TruckInfo | null>(null);
  const [truckInfoLoading, setTruckInfoLoading] = useState(false);

  // Смена пароля
  const [cpOld, setCpOld] = useState("");
  const [cpNew, setCpNew] = useState("");
  const [cpNew2, setCpNew2] = useState("");
  const [cpSaving, setCpSaving] = useState(false);
  const [cpOk, setCpOk] = useState(false);
  const [cpError, setCpError] = useState<string | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [txData, setTxData] = useState<TxData | null>(null);
  const [fullLedger, setFullLedger] = useState<LedgerEntry[]>([]);

  // Формы
  const [mTruckId, setMTruckId] = useState("");
  const [mOdo, setMOdo] = useState("");
  const [mService, setMService] = useState(false);
  const [mNote, setMNote] = useState("");
  const [mSaving, setMSaving] = useState(false);
  const [mOk, setMOk] = useState(false);

  const [eDate, setEDate] = useState(() => isoDate(new Date()));
  const [eAmount, setEAmount] = useState("");
  const [eCategory, setECategory] = useState("");
  const [eDesc, setEDesc] = useState("");
  const [eSaving, setESaving] = useState(false);
  const [eOk, setEOk] = useState(false);
  const [eType, setEType] = useState<"balance" | "compensation">("balance");
  const [ePhotoUploading, setEPhotoUploading] = useState(false);
  const [ePhotoPaths, setEPhotoPaths] = useState<string[]>([]);
  const expensePhotoRef = useRef<HTMLInputElement>(null);

  // Справочник статей расходов (грузится из API)
  type ExpCat = { id: number; name: string; allowed_roles: string; active: boolean };
  const [expenseCategories, setExpenseCategories] = useState<string[]>(EXPENSE_CATEGORIES);

  // Мои заявки на компенсацию
  type MyComp = { id: number; amount: number; category: string; description: string; status: string; created_at: string; reject_reason: string };
  const [myComps, setMyComps] = useState<MyComp[]>([]);
  const [hideClosedComps, setHideClosedComps] = useState(false);

  const [rText, setRText] = useState("");
  const [rSaving, setRSaving] = useState(false);
  const [rOk, setROk] = useState(false);
  const [rTruckId, setRTruckId] = useState<number | null>(null);
  const [rPhotoPaths, setRPhotoPaths] = useState<string[]>([]);
  const [rPhotoUploading, setRPhotoUploading] = useState(false);
  const [rPriority, setRPriority] = useState<"обычная" | "срочная">("обычная");
  const repairPhotoRef = useRef<HTMLInputElement>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Мои заявки на ремонт (только открытые, для карточки ниже экшн-кнопок)
  type MyRepair = { id: number; text: string; status: string; priority: string; created_at: string; truck_label: string };
  const [myRepairs, setMyRepairs] = useState<MyRepair[]>([]);

  // Для бригадира: счётчик алертов для бейджа на кнопке "Бригадир"
  const [foremanAlertCount, setForemanAlertCount] = useState(0);

  // ---------- Загрузка ----------
  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [s, t, sess] = await Promise.all([
        api.get<Summary>("/api/driver-dashboard/summary"),
        api.get<Truck[]>("/api/trucks/"),
        api.get<ActiveSession>("/api/vehicle-inspections/active-session"),
      ]);
      setSummary(s);
      setTrucks(t);
      setActiveSession(sess);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  // Загружаем открытые заявки водителя для секции «Мои заявки»
  useEffect(() => {
    api.get<MyRepair[]>("/api/repair-requests/journal/")
      .then(list => setMyRepairs(list.filter(r => r.status !== "закрыта")))
      .catch(() => {});
  }, []);

  // Для бригадира: загружаем счётчик алертов
  useEffect(() => {
    if (user?.role !== "foreman") return;
    api.get<{ alert_count: number }>("/api/foreman-dashboard/summary")
      .then(d => setForemanAlertCount(d.alert_count))
      .catch(() => {});
  }, [user?.role]);

  // Показываем инструкцию при первом входе
  useEffect(() => {
    if (!localStorage.getItem("driver_instruction_v1")) {
      setModal("instruction");
    }
  }, []);

  // Загружаем справочник статей расходов + мои компенсационные заявки
  useEffect(() => {
    api.get<ExpCat[]>("/api/expense-categories/")
      .then(cats => {
        const names = cats.filter(c => c.active).map(c => c.name);
        setExpenseCategories(names.length > 0 ? names : EXPENSE_CATEGORIES);
        setECategory(prev => prev || names[0] || EXPENSE_CATEGORIES[0]);
      })
      .catch(() => {});
    api.get<MyComp[]>("/api/compensation-requests/journal/")
      .then(list => setMyComps(list))
      .catch(() => {});
  }, []);

  function openModal(m: typeof modal) {
    setFormError(null);
    setMOk(false); setEOk(false); setROk(false);
    if (m === "expense") {
      setEType("balance");
      setEPhotoPaths([]);
      setEDate(isoDate(new Date()));
      setEAmount("");
      setEDesc("");
    }
    if (m === "repair") {
      setRTruckId(activeSession?.truck_id ?? null);
      setRPhotoPaths([]);
      setRText("");
      setRPriority("обычная");
    }
    setModal(m);
  }

  async function handleChangePassword() {
    if (!cpOld) { setCpError("Введите текущий пароль"); return; }
    if (cpNew.length < 6) { setCpError("Новый пароль — минимум 6 символов"); return; }
    if (cpNew !== cpNew2) { setCpError("Пароли не совпадают"); return; }
    setCpSaving(true); setCpError(null);
    try {
      await api.post("/api/auth/change-password", { old_password: cpOld, new_password: cpNew });
      setCpOk(true);
      setCpOld(""); setCpNew(""); setCpNew2("");
    } catch (err) {
      setCpError(err instanceof ApiError ? err.message : "Ошибка");
    } finally { setCpSaving(false); }
  }

  async function openProfile() {
    setModal("profile");
    if (profile) return;
    setProfileLoading(true);
    try {
      setProfile(await api.get<ProfileData>("/api/driver-dashboard/profile"));
    } catch { /* показываем "нет данных" */ }
    finally { setProfileLoading(false); }
  }

  async function openWeekly() {
    setModal("weekly");
    setWeeklyLoading(true);
    const [txs, ledger] = await Promise.all([
      api.get<TxData>("/api/driver-transactions/")
        .catch(() => ({ balance_adjustment: 0, transactions: [] } as TxData)),
      api.get<LedgerEntry[]>("/api/driver-transactions/full-ledger")
        .catch(() => [] as LedgerEntry[]),
    ]);
    setTxData(txs);
    setFullLedger(ledger);
    setWeeklyLoading(false);
  }

  async function handleMileageSubmit() {
    if (!mTruckId) { setFormError("Выберите машину"); return; }
    setMSaving(true); setFormError(null);
    try {
      await api.post("/api/mileage-logs/", {
        truck_id: Number(mTruckId), driver_id: user?.driver_id ?? null,
        odometer: mOdo ? Number(mOdo) : null,
        is_service: mService, note: mNote, date: isoDate(new Date()),
      });
      setMOk(true); setMTruckId(""); setMOdo(""); setMService(false); setMNote("");
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally { setMSaving(false); }
  }

  async function uploadExpensePhoto(file: File) {
    setEPhotoUploading(true);
    try {
      const res = await api.upload<{ filename: string }>("/api/vehicle-inspections/photo", file);
      setEPhotoPaths(prev => [...prev, res.filename]);
    } catch { /* необязательно */ }
    finally { setEPhotoUploading(false); }
  }

  async function handleExpenseSubmit() {
    if (!eAmount || Number(eAmount) <= 0) { setFormError("Введите сумму"); return; }
    setESaving(true); setFormError(null);
    try {
      if (eType === "balance") {
        await api.post("/api/driver-dashboard/expense", {
          expense_date: eDate, amount: Number(eAmount),
          category: eCategory, description: eDesc,
        });
      } else {
        // Запрос компенсации — привязываем машину из активной сессии, если есть
        await api.post("/api/compensation-requests/", {
          expense_date: eDate, amount: Number(eAmount),
          category: eCategory, description: eDesc,
          photo_paths: JSON.stringify(ePhotoPaths),
          truck_id: activeSession?.truck_id ?? null,
        });
      }
      setEOk(true); setEAmount(""); setEDesc(""); setEPhotoPaths([]);
      // Обновить список моих компенсаций после отправки
      if (eType === "compensation") {
        api.get<MyComp[]>("/api/compensation-requests/journal/")
          .then(list => setMyComps(list))
          .catch(() => {});
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally { setESaving(false); }
  }

  async function uploadRepairPhoto(file: File) {
    setRPhotoUploading(true);
    try {
      const res = await api.upload<{ filename: string }>("/api/vehicle-inspections/photo", file);
      setRPhotoPaths(prev => [...prev, res.filename]);
    } catch { /* игнорируем — фото необязательно */ }
    finally { setRPhotoUploading(false); }
  }

  async function handleRepairSubmit() {
    if (!rText.trim()) { setFormError("Опишите проблему"); return; }
    setRSaving(true); setFormError(null);
    try {
      await api.post("/api/repair-requests/", {
        driver_id: user?.driver_id ?? null,
        truck_id: rTruckId,
        text: rText.trim(),
        photo_paths: JSON.stringify(rPhotoPaths),
        priority: rPriority,
      });
      setROk(true); setRText(""); setRPhotoPaths([]); setRPriority("обычная");
      // Обновить «Мои заявки» после создания новой
      api.get<MyRepair[]>("/api/repair-requests/journal/")
        .then(list => setMyRepairs(list.filter(r => r.status !== "закрыта")))
        .catch(() => {});
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally { setRSaving(false); }
  }

  const initial = (user?.full_name || user?.username || "В").charAt(0).toUpperCase();
  const lastWeekEnd = summary?.last_week_start
    ? (() => { const d = new Date(summary.last_week_start!); d.setDate(d.getDate() + 6); return d.toISOString().slice(0, 10); })()
    : null;

  return (
    <div style={{
      minHeight: "100dvh",
      background: C.bg,
      color: C.ink,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      maxWidth: 480,
      margin: "0 auto",
    }}>

      {/* ══════════ ШАПКА ══════════ */}
      <div style={{
        background: C.card,
        borderBottom: `1px solid ${C.border}`,
        padding: `max(env(safe-area-inset-top, 0px), 14px) 20px 14px`,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}>
        <button
          onClick={openProfile}
          style={{
            width: 42, height: 42, borderRadius: "50%",
            background: C.iris,
            display: "grid", placeItems: "center",
            color: "#fff", fontWeight: 700, fontSize: 17,
            flexShrink: 0,
            border: "none", cursor: "pointer", padding: 0,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {initial}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: C.ink2, letterSpacing: 0.4, textTransform: "uppercase" }}>
            Водитель
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {user?.full_name || user?.username}
          </div>
        </div>

        {/* Кнопка "Бригадир" — только для пользователей с ролью foreman */}
        {user?.role === "foreman" && (
          <button
            onClick={() => navigate("/foreman")}
            style={{
              position: "relative",
              background: C.irisLight,
              border: "none", color: C.iris, borderRadius: 10,
              padding: "7px 13px", fontSize: 13, cursor: "pointer",
              fontFamily: "inherit", fontWeight: 600,
              flexShrink: 0,
            }}
          >
            👷 Бригадир
            {foremanAlertCount > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                background: "#e74c3c", color: "#fff",
                borderRadius: "50%", fontSize: 9, fontWeight: 700,
                width: 16, height: 16, lineHeight: "16px",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {foremanAlertCount > 9 ? "9+" : foremanAlertCount}
              </span>
            )}
          </button>
        )}

        <button
          onClick={() => setModal("instruction")}
          title="Инструкция"
          style={{
            width: 36, height: 36, borderRadius: "50%",
            background: C.irisLight, border: "none",
            color: C.iris, fontSize: 17, fontWeight: 700,
            cursor: "pointer", flexShrink: 0, padding: 0,
            display: "grid", placeItems: "center",
            lineHeight: 1,
          }}
        >
          ℹ
        </button>

        <button
          onClick={() => { logout(); navigate("/login", { replace: true }); }}
          style={{
            background: C.bg,
            border: "none", color: C.ink2, borderRadius: 10,
            padding: "7px 13px", fontSize: 13, cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Выйти
        </button>
      </div>

      {/* ══════════ ТЕЛО ══════════ */}
      <div style={{ padding: "16px 16px 40px" }}>

        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.ink2, fontSize: 14 }}>
            Загрузка...
          </div>
        )}
        {!loading && error && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--ember,#e74c3c)", fontSize: 14 }}>
            {error}
          </div>
        )}

        {!loading && !error && (<>

          {/* ── Баннер активной машины ── */}
          {activeSession && (
            <div style={{
              background: `linear-gradient(135deg, ${C.good}18, ${C.good}08)`,
              border: `1.5px solid ${C.good}40`,
              borderRadius: C.radius,
              padding: "14px 16px",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}>
              <div
                onClick={async () => {
                  if (truckInfo) { setModal("truckinfo" as typeof modal); return; }
                  setTruckInfoLoading(true);
                  try {
                    const info = await api.get<TruckInfo>(`/api/driver-dashboard/truck/${activeSession.truck_id}`);
                    setTruckInfo(info);
                    setModal("truckinfo" as typeof modal);
                  } catch { /* игнорируем */ } finally { setTruckInfoLoading(false); }
                }}
                style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, cursor: "pointer" }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: C.good,
                  display: "grid", placeItems: "center",
                  flexShrink: 0, fontSize: 18,
                }}>
                  {truckInfoLoading ? "⏳" : "🚛"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: C.good, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
                    Принята · нажмите для сводки
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: C.ink }}>
                    {activeSession.truck_plate || activeSession.truck_label}
                  </div>
                  <div style={{ fontSize: 12, color: C.ink2 }}>
                    с {new Date(activeSession.started_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
                  </div>
                </div>
              </div>
              {/* Кнопка Сдать машину — справа от виджета */}
              <button
                onClick={() => openModal("handover")}
                style={{
                  background: C.good, border: "none", color: "#fff",
                  borderRadius: 10, padding: "8px 14px", fontSize: 13,
                  fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  flexShrink: 0, whiteSpace: "nowrap",
                }}
              >
                Сдать
              </button>
            </div>
          )}

          {/* ── Карточка баланса ── */}
          <div style={{
            background: C.card,
            borderRadius: C.radius,
            boxShadow: C.cardShadow,
            padding: "20px 20px 18px",
            marginBottom: 12,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 11, color: C.ink2, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 }}>
                  Баланс
                </div>
                <div style={{
                  fontSize: 36, fontWeight: 700, letterSpacing: -1, lineHeight: 1,
                  color: (summary?.balance ?? 0) < 0 ? "var(--ember,#e74c3c)" : C.iris,
                }}>
                  {money(summary?.balance ?? 0)}
                </div>
                {summary?.as_of && (
                  <div style={{ fontSize: 12, color: C.ink2, marginTop: 6 }}>
                    по данным на {fmtDate(summary.as_of)}
                  </div>
                )}
              </div>

              <button
                onClick={openWeekly}
                title="Отчёт по неделям"
                style={{
                  background: C.irisLight,
                  border: "none", color: C.iris,
                  borderRadius: 10,
                  width: 40, height: 40,
                  display: "grid", placeItems: "center",
                  cursor: "pointer", flexShrink: 0,
                  marginTop: 2,
                }}
              >
                <DocIcon />
              </button>
            </div>
          </div>

          {/* ── Карточки рейсов ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>

            {/* Выполненные рейсы */}
            <button
              onClick={() => {
                const from = summary?.last_week_start ?? null;
                const to = lastWeekEnd;
                navigate(`/driver/trips${from && to ? `?from=${from}&to=${to}&filter=completed` : "?filter=completed"}`);
              }}
              style={{
                background: C.card, borderRadius: C.radius, boxShadow: C.cardShadow,
                padding: "14px 16px", width: "100%", border: "none", cursor: "pointer",
                textAlign: "left", display: "flex", alignItems: "center", gap: 12, fontFamily: "inherit",
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: C.dark, display: "grid", placeItems: "center", flexShrink: 0 }}>
                <span style={{ fontFamily: "'icon-works', sans-serif", fontSize: 22, color: "#fff", lineHeight: 1, userSelect: "none" }}
                  dangerouslySetInnerHTML={{ __html: "&#66;" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: C.ink2, marginBottom: 3 }}>
                  {weekLabel(summary?.last_week_start ?? null, lastWeekEnd)}
                </div>
                <div style={{ fontSize: 12, color: C.ink2 }}>Рейсов за период</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: C.ink, lineHeight: 1.2 }}>
                  {summary?.last_week_trips ?? 0}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.good }}>
                  {(summary?.last_week_payout ?? 0) > 0 ? money(summary!.last_week_payout) : "—"}
                </div>
                <div style={{ fontSize: 18, color: C.ink2, marginTop: 6 }}>›</div>
              </div>
            </button>

            {/* Отменённые рейсы */}
            {(summary?.last_week_cancelled ?? 0) > 0 && (
              <button
                onClick={() => {
                  const from = summary?.last_week_start ?? null;
                  const to = lastWeekEnd;
                  navigate(`/driver/trips${from && to ? `?from=${from}&to=${to}&filter=cancelled` : "?filter=cancelled"}`);
                }}
                style={{
                  background: C.card, borderRadius: C.radius, boxShadow: C.cardShadow,
                  padding: "14px 16px", width: "100%", border: "none", cursor: "pointer",
                  textAlign: "left", display: "flex", alignItems: "center", gap: 12, fontFamily: "inherit",
                }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 12, background: "#e74c3c18", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 22, lineHeight: 1, color: "#e74c3c" }}>✕</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: C.ink2, marginBottom: 3 }}>
                    {weekLabel(summary?.last_week_start ?? null, lastWeekEnd)}
                  </div>
                  <div style={{ fontSize: 12, color: C.ink2 }}>Отменено рейсов</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#e74c3c", lineHeight: 1.2 }}>
                    {summary?.last_week_cancelled}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#e74c3c" }}>
                    {(summary?.last_week_cancelled_fines ?? 0) > 0 ? `−${money(summary!.last_week_cancelled_fines)}` : "—"}
                  </div>
                  <div style={{ fontSize: 18, color: C.ink2, marginTop: 6 }}>›</div>
                </div>
              </button>
            )}
          </div>

          {/* ── Кнопки действий 3 в строку ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <ActionCard icon="&#228;" label="Пробег +"        onClick={() => openModal("mileage")} />
            <ActionCard icon="&#91;"  label="Расход +"         onClick={() => openModal("expense")} />
            <ActionCard icon="&#245;" label="Ремонт"           onClick={() => openModal("repair")} />
          </div>
          {/* Кнопка приёмки — отдельно, только если нет активной сессии */}
          {!activeSession && (
            <div style={{ marginTop: 10 }}>
              <ActionCard
                icon="&#47;"
                label="Принять машину"
                accent={false}
                onClick={() => openModal("handover")}
              />
            </div>
          )}

          {/* ── Мои заявки на компенсацию ── */}
          {myComps.length > 0 && (
            <div style={{
              marginTop: 16,
              background: C.card,
              borderRadius: 16,
              padding: "16px 18px",
              boxShadow: "0 1px 6px rgba(0,0,0,.06)",
            }}>
              <div style={{
                fontSize: 13, fontWeight: 700, color: C.ink,
                marginBottom: 10, display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                💸 Компенсации
                {myComps.filter(c => c.status === "на рассмотрении").length > 0 && (
                  <span style={{
                    background: "#d99a3a18", color: "#d99a3a",
                    borderRadius: 8, fontSize: 11, fontWeight: 700,
                    padding: "1px 7px",
                  }}>
                    {myComps.filter(c => c.status === "на рассмотрении").length} на рассмотрении
                  </span>
                )}
                </span>
                <button type="button" onClick={() => setHideClosedComps(p => !p)} style={{
                  background: "none", border: "none", cursor: "pointer", padding: "2px 6px",
                  fontSize: 11, color: hideClosedComps ? C.iris : C.ink2,
                  fontFamily: "inherit", fontWeight: hideClosedComps ? 700 : 400,
                  flexShrink: 0,
                }}>
                  {hideClosedComps ? "Показать все" : "Скрыть закрытые"}
                </button>
              </div>
              {(hideClosedComps
                ? myComps.filter(c => c.status === "на рассмотрении")
                : myComps
              ).slice(0, 4).map(c => {
                const stMap: Record<string, { color: string; bg: string; label: string }> = {
                  "на рассмотрении": { color: "#d99a3a", bg: "#d99a3a18", label: "На рассмотрении" },
                  "принято":         { color: "#27ae60", bg: "#27ae6018", label: "Принято" },
                  "отказано":        { color: "#e74c3c", bg: "#e74c3c18", label: "Отказано" },
                };
                const st = stMap[c.status] ?? { color: C.ink2, bg: C.irisLight, label: c.status };
                return (
                  <div key={c.id} style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    paddingTop: 9, paddingBottom: 9,
                    borderTop: `1px solid ${C.border ?? "#efefef"}`,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, color: C.ink, fontWeight: 600,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {c.category} · {Number(c.amount).toLocaleString("ru-RU")} ₽
                      </div>
                      {c.description && (
                        <div style={{
                          fontSize: 11, color: C.ink2, marginTop: 1,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {c.description}
                        </div>
                      )}
                      {c.status === "отказано" && c.reject_reason && (
                        <div style={{ fontSize: 11, color: "#e74c3c", marginTop: 2 }}>
                          Причина: {c.reject_reason}
                        </div>
                      )}
                    </div>
                    <span style={{
                      background: st.bg, color: st.color,
                      borderRadius: 8, fontSize: 11, fontWeight: 700,
                      padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0,
                    }}>
                      {st.label}
                    </span>
                  </div>
                );
              })}
              {myComps.length > 4 && (
                <div style={{ fontSize: 12, color: C.ink2, textAlign: "center", paddingTop: 8 }}>
                  +{myComps.length - 4} ещё...
                </div>
              )}
            </div>
          )}

          {/* ── Мои открытые заявки на ремонт ── */}
          {myRepairs.length > 0 && (
            <div style={{
              marginTop: 16,
              background: C.card,
              borderRadius: 16,
              padding: "16px 18px",
              boxShadow: "0 1px 6px rgba(0,0,0,.06)",
            }}>
              <div style={{
                fontSize: 13, fontWeight: 700, color: C.ink,
                marginBottom: 10, display: "flex", alignItems: "center", gap: 8,
              }}>
                🔧 Мои заявки на ремонт
                <span style={{
                  background: "#5683da18", color: "#5683da",
                  borderRadius: 8, fontSize: 11, fontWeight: 700,
                  padding: "1px 7px",
                }}>
                  {myRepairs.length}
                </span>
              </div>
              {myRepairs.slice(0, 4).map(r => {
                const isUrgent = r.priority === "срочная";
                const stColor = r.status === "в работе" ? "#d99a3a" : "#5683da";
                const stBg    = r.status === "в работе" ? "#f39c1218" : "#5683da18";
                return (
                  <div key={r.id} style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    paddingTop: 9, paddingBottom: 9,
                    borderTop: `1px solid ${C.border ?? "#efefef"}`,
                  }}>
                    {isUrgent && (
                      <span style={{
                        background: "#e74c3c", color: "#fff",
                        borderRadius: 4, fontSize: 10, fontWeight: 700,
                        padding: "2px 5px", whiteSpace: "nowrap", marginTop: 1,
                        flexShrink: 0,
                      }}>СРЧ</span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, color: C.ink,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {r.text}
                      </div>
                      <div style={{ fontSize: 11, color: C.ink2, marginTop: 2 }}>
                        {r.truck_label} · {new Date(r.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}
                      </div>
                    </div>
                    <span style={{
                      background: stBg, color: stColor,
                      borderRadius: 8, fontSize: 11, fontWeight: 700,
                      padding: "2px 8px", whiteSpace: "nowrap", flexShrink: 0,
                    }}>
                      {r.status === "в работе" ? "В работе" : "Создана"}
                    </span>
                  </div>
                );
              })}
              {myRepairs.length > 4 && (
                <div style={{ fontSize: 12, color: C.ink2, textAlign: "center", paddingTop: 8 }}>
                  +{myRepairs.length - 4} ещё...
                </div>
              )}
            </div>
          )}

        </>)}
      </div>

      {/* ══════════ МОДАЛКИ ══════════ */}
      {modal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,.4)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            key={modal}
            className="slide-up-sheet"
            style={{
              background: C.card,
              borderRadius: "22px 22px 0 0",
              padding: `20px 20px max(env(safe-area-inset-bottom, 0px), 32px)`,
              width: "100%",
              maxWidth: 480,
              maxHeight: "92dvh",
              overflowY: "auto",
            }}
          >

            {/* Выписка по балансу */}
            {modal === "weekly" && (() => {
              const TX_LABELS: Record<string, string> = {
                pnl_accrual:  "Начислено",
                pnl_payment:  "Выплачено",
                compensation: "Компенсация",
                advance:      "Аванс",
                fine_pdd:     "Штраф ПДД",
                fine_company: "Штраф от компании",
                payout:       "Выплата",
              };
              const txList = txData?.transactions ?? [];
              return (
                <div>
                  <SheetHeader title="Выписка по балансу" onClose={() => setModal(null)} />

                  {/* Итоговый баланс */}
                  <div style={{
                    background: C.bg, borderRadius: 12, padding: "12px 16px",
                    marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <span style={{ fontSize: 13, color: C.ink2 }}>Баланс</span>
                    <span style={{
                      fontSize: 20, fontWeight: 700,
                      color: (summary?.balance ?? 0) < 0 ? "var(--ember,#e74c3c)" : C.iris,
                    }}>
                      {money(summary?.balance ?? 0)}
                    </span>
                  </div>

                  {weeklyLoading ? (
                    <div style={{ textAlign: "center", padding: "32px 0", color: C.ink2 }}>Загрузка...</div>
                  ) : fullLedger.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "32px 0", color: C.ink2 }}>
                      Операций пока нет
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {fullLedger.map((entry, i) => {
                        const isCredit = entry.amount > 0;
                        const isPnl = entry.entry_type === "pnl_accrual" || entry.entry_type === "pnl_payment";
                        return (
                          <div key={i} style={{
                            background: isPnl ? C.irisLight : C.bg,
                            borderRadius: 12, padding: "12px 14px",
                            display: "flex", alignItems: "flex-start", gap: 12,
                            borderLeft: `3px solid ${isCredit ? "#27ae60" : "var(--ember,#e74c3c)"}`,
                          }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, color: C.ink }}>
                                {TX_LABELS[entry.entry_type] ?? entry.entry_type}
                              </div>
                              {entry.description && (
                                <div style={{
                                  fontSize: 11, color: C.ink2, marginTop: 2,
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>
                                  {entry.description}
                                </div>
                              )}
                              <div style={{ fontSize: 11, color: C.ink2, marginTop: 2 }}>
                                {fmtDate(entry.date)}
                              </div>
                            </div>
                            <span style={{
                              fontWeight: 700, fontSize: 14, whiteSpace: "nowrap",
                              color: isCredit ? "#27ae60" : "var(--ember,#e74c3c)",
                            }}>
                              {isCredit ? "+" : ""}{money(entry.amount)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <MBtn onClick={() => setModal(null)} style={{ marginTop: 16 }}>Закрыть</MBtn>
                </div>
              );
            })()}

            {/* Пробег + */}
            {modal === "mileage" && (
              <ModalContent
                title="Показание пробега" onClose={() => setModal(null)}
                onSubmit={handleMileageSubmit} saving={mSaving}
                ok={mOk} okMessage="Показание сохранено!" error={formError}
              >
                <MLabel>Машина</MLabel>
                <select value={mTruckId} onChange={e => setMTruckId(e.target.value)} style={inputStyle}>
                  <option value="">— выберите машину —</option>
                  {trucks.map(t => <option key={t.id} value={t.id}>{t.plate || t.label || `Машина #${t.id}`}</option>)}
                </select>
                <MLabel>Показание одометра (км)</MLabel>
                <input type="number" inputMode="numeric" style={inputStyle}
                  value={mOdo} onChange={e => setMOdo(e.target.value)}
                  placeholder="например, 145200" />
                <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, fontSize: 14, color: C.ink, cursor: "pointer" }}>
                  <input type="checkbox" checked={mService} onChange={e => setMService(e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: C.dark }} />
                  ТО/сервис (отметить если было обслуживание)
                </label>
                <MLabel>Примечание</MLabel>
                <input type="text" style={{ ...inputStyle, marginBottom: 0 }}
                  value={mNote} onChange={e => setMNote(e.target.value)} placeholder="необязательно" />
              </ModalContent>
            )}

            {/* Расход + */}
            {modal === "expense" && (
              <ModalContent
                title="Добавить расход" onClose={() => setModal(null)}
                onSubmit={handleExpenseSubmit} saving={eSaving}
                ok={eOk}
                okMessage={eType === "balance" ? "Расход сохранён!" : "Заявка отправлена!"}
                error={formError}
                submitLabel={eType === "balance" ? "Сохранить" : "Отправить заявку"}
              >
                {/* Тип расхода */}
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  {(["balance", "compensation"] as const).map(t => (
                    <button key={t} type="button" onClick={() => setEType(t)} style={{
                      flex: 1, border: "none", borderRadius: 10, padding: "10px 0",
                      fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                      background: eType === t ? C.iris : C.irisLight,
                      color: eType === t ? "#fff" : C.iris,
                      transition: "background .15s, color .15s",
                    }}>
                      {t === "balance" ? "С баланса" : "Компенсация"}
                    </button>
                  ))}
                </div>
                {eType === "compensation" && (
                  <div style={{ fontSize: 12, color: C.ink2, marginBottom: 12, lineHeight: 1.5 }}>
                    Заявка уйдёт на рассмотрение. При одобрении сумма будет начислена на баланс.
                  </div>
                )}
                <MLabel>Дата</MLabel>
                <input type="date" style={inputStyle} value={eDate} onChange={e => setEDate(e.target.value)} />
                <MLabel>Сумма, ₽</MLabel>
                <input type="number" inputMode="decimal" style={inputStyle}
                  value={eAmount} onChange={e => setEAmount(e.target.value)} placeholder="0.00" />
                <MLabel>Статья</MLabel>
                <select style={inputStyle} value={eCategory} onChange={e => setECategory(e.target.value)}>
                  {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <MLabel>Описание</MLabel>
                <input type="text" style={{ ...inputStyle, marginBottom: eType === "compensation" ? 10 : 0 }}
                  value={eDesc} onChange={e => setEDesc(e.target.value)} placeholder="необязательно" />
                {/* Фото чека — только для компенсаций */}
                {eType === "compensation" && (<>
                  <input ref={expensePhotoRef} type="file" accept="image/*" capture="environment"
                    style={{ display: "none" }}
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      if (f) await uploadExpensePhoto(f);
                      if (expensePhotoRef.current) expensePhotoRef.current.value = "";
                    }}
                  />
                  <button type="button" onClick={() => expensePhotoRef.current?.click()}
                    disabled={ePhotoUploading || ePhotoPaths.length >= 5}
                    style={{
                      width: "100%", border: "none", borderRadius: 10,
                      padding: "11px 16px", background: C.irisLight, color: C.iris,
                      fontSize: 13, fontWeight: 600, cursor: ePhotoPaths.length >= 5 ? "default" : "pointer",
                      fontFamily: "inherit", marginBottom: ePhotoPaths.length > 0 ? 8 : 0,
                    }}>
                    {ePhotoUploading ? "⏳ Загрузка..." : `📷 Добавить чек${ePhotoPaths.length > 0 ? ` (${ePhotoPaths.length})` : ""}`}
                  </button>
                  {ePhotoPaths.length > 0 && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {ePhotoPaths.map((p, i) => (
                        <a key={i} href={fileUrl(`/photos/${p}`)} target="_blank" rel="noreferrer"
                          style={{ fontSize: 26, textDecoration: "none", lineHeight: 1 }}>📷</a>
                      ))}
                    </div>
                  )}
                </>)}
              </ModalContent>
            )}

            {/* Заявка на ремонт */}
            {modal === "repair" && (
              <ModalContent
                title="Заявка на ремонт" onClose={() => setModal(null)}
                onSubmit={handleRepairSubmit} saving={rSaving}
                ok={rOk} okMessage="Заявка отправлена!" error={formError}
                submitLabel="Отправить"
              >
                {/* Машина */}
                {activeSession ? (
                  <div style={{ fontSize: 13, color: C.ink2, marginBottom: 10 }}>
                    Машина: <strong style={{ color: C.ink }}>{activeSession.truck_plate || activeSession.truck_label}</strong>
                  </div>
                ) : trucks.length > 0 && (
                  <>
                    <MLabel>Машина</MLabel>
                    <select
                      style={inputStyle}
                      value={rTruckId ?? ""}
                      onChange={e => setRTruckId(e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">— не выбрана —</option>
                      {trucks.map(t => (
                        <option key={t.id} value={t.id}>{t.plate} {t.label}</option>
                      ))}
                    </select>
                  </>
                )}
                {/* Срочность */}
                <MLabel>Срочность</MLabel>
                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  {(["обычная", "срочная"] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setRPriority(p)}
                      style={{
                        flex: 1, border: "none", borderRadius: 10,
                        padding: "10px 0", fontSize: 13, fontWeight: 600,
                        fontFamily: "inherit", cursor: "pointer",
                        background: rPriority === p
                          ? (p === "срочная" ? "#e74c3c" : C.iris)
                          : C.irisLight,
                        color: rPriority === p ? "#fff" : C.iris,
                        transition: "background .15s, color .15s",
                      }}
                    >
                      {p === "срочная" ? "🔴 Срочная" : "Обычная"}
                    </button>
                  ))}
                </div>
                <MLabel>Опишите проблему</MLabel>
                <textarea style={{ ...inputStyle, resize: "vertical", marginBottom: 10 }}
                  value={rText} onChange={e => setRText(e.target.value)}
                  placeholder="Например: стук в правом переднем колесе..."
                  rows={5} />
                {/* Фото */}
                <input
                  ref={repairPhotoRef}
                  type="file" accept="image/*" capture="environment"
                  style={{ display: "none" }}
                  onChange={async e => {
                    const f = e.target.files?.[0];
                    if (f) await uploadRepairPhoto(f);
                    if (repairPhotoRef.current) repairPhotoRef.current.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => repairPhotoRef.current?.click()}
                  disabled={rPhotoUploading || rPhotoPaths.length >= 5}
                  style={{
                    width: "100%", border: "none", borderRadius: 10,
                    padding: "11px 16px", background: C.irisLight,
                    color: C.iris, fontSize: 13, fontWeight: 600,
                    cursor: rPhotoPaths.length >= 5 ? "default" : "pointer",
                    fontFamily: "inherit", marginBottom: rPhotoPaths.length > 0 ? 8 : 0,
                  }}
                >
                  {rPhotoUploading
                    ? "⏳ Загрузка..."
                    : `📷 Добавить фото${rPhotoPaths.length > 0 ? ` (${rPhotoPaths.length})` : ""}`}
                </button>
                {rPhotoPaths.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {rPhotoPaths.map((p, i) => (
                      <a key={i} href={fileUrl(`/photos/${p}`)} target="_blank" rel="noreferrer"
                         style={{ fontSize: 26, textDecoration: "none", lineHeight: 1 }}
                         title="Открыть фото">📷</a>
                    ))}
                  </div>
                )}
              </ModalContent>
            )}

            {/* Сводка по машине */}
            {modal === "truckinfo" && truckInfo && (
              <TruckInfoSheet info={truckInfo} onClose={() => setModal(null)} />
            )}

            {/* П/П Авто — полная форма приёмки/сдачи */}
            {modal === "handover" && (
              <HandoverSheet
                trucks={trucks}
                activeSession={activeSession}
                driverId={user?.driver_id ?? null}
                onClose={() => setModal(null)}
                onDone={(sess) => {
                  setActiveSession(sess);
                  setTruckInfo(null); // сбросить кэш при смене машины
                  setModal(null);
                }}
              />
            )}

            {/* Профиль водителя */}
            {modal === "profile" && (
              <div>
                <SheetHeader title="Профиль водителя" onClose={() => setModal(null)} />
                {profileLoading ? (
                  <div style={{ textAlign: "center", padding: "32px 0", color: C.ink2 }}>Загрузка...</div>
                ) : !profile ? (
                  <div style={{ textAlign: "center", padding: "32px 0", color: C.ink2 }}>Нет данных</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <ProfileSection title="ФИО">
                      <InfoRow label="Фамилия"  value={profile.last_name   || "—"} />
                      <InfoRow label="Имя"      value={profile.first_name  || "—"} />
                      <InfoRow label="Отчество" value={profile.middle_name || "—"} />
                    </ProfileSection>
                    <ProfileSection title="Паспорт">
                      <InfoRow label="Серия и номер" value={profile.passport_number || "—"} />
                      <InfoRow label="Дата выдачи"   value={fmtDate(profile.passport_issued_date)} />
                    </ProfileSection>
                    <ProfileSection title="Водительское удостоверение">
                      <InfoRow label="Номер"        value={profile.license_number || "—"} />
                      <InfoRow label="Дата выдачи"  value={fmtDate(profile.license_issued_date)} />
                      <InfoRow label="Действует до" value={fmtDate(profile.license_valid_until)} />
                    </ProfileSection>
                    <ProfileSection title="Карточка СКЗИ">
                      <InfoRow label="Номер карточки" value={profile.skzi_card_number || "—"} />
                      <InfoRow label="Срок действия"  value={fmtDate(profile.skzi_valid_until)} />
                    </ProfileSection>
                    <ProfileSection title="Условия оплаты">
                      {profile.payment_terms.length === 0 ? (
                        <div style={{ fontSize: 13, color: C.ink2 }}>Не настроено</div>
                      ) : profile.payment_terms.map((pt, i) => (
                        <InfoRow key={i} label={pt.carrier} value={formatRate(pt.rate_type, pt.rate_value)} />
                      ))}
                    </ProfileSection>
                  </div>
                )}
                <MBtn
                  onClick={() => { setCpOk(false); setCpError(null); setModal("changepass"); }}
                  solid={false}
                  style={{ marginTop: 12 }}
                >
                  🔑 Сменить пароль
                </MBtn>
                <MBtn onClick={() => setModal(null)} style={{ marginTop: 8 }}>Закрыть</MBtn>
              </div>
            )}

            {/* Инструкция */}
            {modal === "instruction" && (
              <div>
                <SheetHeader title="Инструкция для водителя" onClose={() => {
                  localStorage.setItem("driver_instruction_v1", "1");
                  setModal(null);
                }} />
                <InstructionContent />
                <MBtn onClick={() => {
                  localStorage.setItem("driver_instruction_v1", "1");
                  setModal(null);
                }} style={{ marginTop: 16 }}>
                  Понятно
                </MBtn>
              </div>
            )}

            {/* Смена пароля */}
            {modal === "changepass" && (
              <ModalContent
                title="Смена пароля" onClose={() => setModal(null)}
                onSubmit={handleChangePassword} saving={cpSaving}
                ok={cpOk} okMessage="Пароль успешно изменён!"
                error={cpError} submitLabel="Изменить пароль"
              >
                <MLabel>Текущий пароль</MLabel>
                <input type="password" style={inputStyle}
                  value={cpOld} onChange={e => setCpOld(e.target.value)}
                  autoComplete="current-password" />
                <MLabel>Новый пароль</MLabel>
                <input type="password" style={inputStyle}
                  value={cpNew} onChange={e => setCpNew(e.target.value)}
                  placeholder="Минимум 6 символов"
                  autoComplete="new-password" />
                <MLabel>Повторите новый пароль</MLabel>
                <input type="password" style={{ ...inputStyle, marginBottom: 0 }}
                  value={cpNew2} onChange={e => setCpNew2(e.target.value)}
                  autoComplete="new-password" />
              </ModalContent>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HandoverSheet — полная форма приёмки / сдачи авто
// ══════════════════════════════════════════════════════════════════════════════

type HandoverSheetProps = {
  trucks: Truck[];
  activeSession: ActiveSession;
  driverId: number | null;
  onClose: () => void;
  onDone: (newSession: ActiveSession) => void;
};

type HStep = "select" | "form" | "submitting" | "ok";

function HandoverSheet({ trucks, activeSession, driverId, onClose, onDone }: HandoverSheetProps) {
  const kind = activeSession ? "end" : "start";
  const [step, setStep] = useState<HStep>(activeSession ? "form" : "select");

  // Выбор машины
  const [selectedTruckId, setSelectedTruckId] = useState<number | null>(
    activeSession ? activeSession.truck_id : null
  );
  const [activeSessions, setActiveSessions] = useState<ActiveSessionEntry[]>([]);
  const [sessLoading, setSessLoading] = useState(false);

  // Форма
  const [odometer, setOdometer] = useState("");
  const [block1, setBlock1] = useState<CheckItem[]>(() => makeItems(BLOCK1_LABELS));
  const [block2, setBlock2] = useState<CheckItem[]>(() => makeItems(BLOCK2_LABELS));
  const [block3, setBlock3] = useState<CheckItem[]>(() => makeItems(DEFAULT_EQUIPMENT));
  const [damages, setDamages] = useState<DamageEntry[]>([]);
  const [cleanItems, setCleanItems] = useState<CleanItem[]>([
    { label: "Салон", status: "" },
    { label: "Внешний вид", status: "" },
  ]);
  const [sidePhotos, setSidePhotos] = useState<SidePhoto[]>([
    { key: "front", label: "Спереди" },
    { key: "left", label: "Слева" },
    { key: "back", label: "Сзади" },
    { key: "right", label: "Справа" },
  ]);
  const sideFileRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [rigging, setRigging] = useState<RiggingItem[]>([
    { label: "Ремни", status: "", qty: "" },
    { label: "Распорки", status: "", qty: "" },
  ]);
  const [equipLoading, setEquipLoading] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingDmgId, setUploadingDmgId] = useState<string | null>(null);

  // Загружаем статусы машин при открытии шага "select"
  useEffect(() => {
    if (step !== "select") return;
    setSessLoading(true);
    api.get<ActiveSessionEntry[]>("/api/vehicle-inspections/active-sessions")
      .then(setActiveSessions)
      .catch(() => setActiveSessions([]))
      .finally(() => setSessLoading(false));
  }, [step]);

  // Загружаем комплектацию выбранной машины
  async function loadEquipment(truckId: number) {
    setEquipLoading(true);
    try {
      const items = await api.get<Array<{ id: number | null; label: string; sort_order: number }>>(
        `/api/trucks/${truckId}/equipment`
      );
      setBlock3(items.map(i => ({ label: i.label, status: "" as const, note: "" })));
    } catch {
      setBlock3(makeItems(DEFAULT_EQUIPMENT));
    } finally {
      setEquipLoading(false);
    }
  }

  function selectTruck(truckId: number) {
    setSelectedTruckId(truckId);
    setStep("form");
    loadEquipment(truckId);
  }

  // Обновить пункт чеклиста
  function toggleStatus(
    items: CheckItem[], setItems: React.Dispatch<React.SetStateAction<CheckItem[]>>,
    idx: number, value: "yes" | "no"
  ) {
    setItems(prev => prev.map((it, i) =>
      i === idx ? { ...it, status: it.status === value ? "" : value } : it
    ));
  }
  function setNote(
    setItems: React.Dispatch<React.SetStateAction<CheckItem[]>>,
    idx: number, note: string
  ) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, note } : it));
  }
  function setCount(
    setItems: React.Dispatch<React.SetStateAction<CheckItem[]>>,
    idx: number, count: string
  ) {
    setItems(prev => prev.map((it, i) =>
      i === idx ? { ...it, count: count ? Number(count) : undefined } : it
    ));
  }

  // Такелаж
  function toggleRigging(idx: number, value: "yes" | "no") {
    setRigging(prev => prev.map((it, i) =>
      i === idx ? { ...it, status: it.status === value ? "" : value } : it
    ));
  }
  function setRiggingQty(idx: number, qty: string) {
    setRigging(prev => prev.map((it, i) => i === idx ? { ...it, qty } : it));
  }

  // Повреждения
  function addDamage() {
    setDamages(prev => [...prev, { id: crypto.randomUUID(), description: "" }]);
  }
  function removeDamage(id: string) {
    setDamages(prev => prev.filter(d => d.id !== id));
  }
  function setDmgDesc(id: string, description: string) {
    setDamages(prev => prev.map(d => d.id === id ? { ...d, description } : d));
  }

  // Загрузка фото повреждения
  async function uploadPhoto(dmgId: string, file: File) {
    setUploadingDmgId(dmgId);
    try {
      const compressed = await compressPhoto(file);
      const res = await api.upload<{ filename: string }>("/api/vehicle-inspections/photo", compressed);
      setDamages(prev => prev.map(d =>
        d.id === dmgId ? { ...d, photoFile: file, photoPath: res.filename } : d
      ));
    } catch {
      // игнорируем — фото необязательно
    } finally {
      setUploadingDmgId(null);
    }
  }

  // Загрузка фото к примечанию пункта чеклиста
  async function uploadItemPhoto(
    setItems: React.Dispatch<React.SetStateAction<CheckItem[]>>,
    idx: number, file: File
  ) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, photoUploading: true } : it));
    try {
      const compressed = await compressPhoto(file);
      const res = await api.upload<{ filename: string }>("/api/vehicle-inspections/photo", compressed);
      setItems(prev => prev.map((it, i) => i === idx ? { ...it, photoPath: res.filename, photoUploading: false } : it));
    } catch {
      setItems(prev => prev.map((it, i) => i === idx ? { ...it, photoUploading: false } : it));
    }
  }

  // Загрузка фото чистоты
  async function uploadCleanPhoto(idx: number, file: File) {
    setCleanItems(prev => prev.map((it, i) => i === idx ? { ...it, uploading: true } : it));
    try {
      const compressed = await compressPhoto(file);
      const res = await api.upload<{ filename: string }>("/api/vehicle-inspections/photo", compressed);
      setCleanItems(prev => prev.map((it, i) => i === idx ? { ...it, photoPath: res.filename, uploading: false } : it));
    } catch {
      setCleanItems(prev => prev.map((it, i) => i === idx ? { ...it, uploading: false } : it));
    }
  }

  // Загрузка фото 4 сторон
  async function uploadSidePhoto(idx: number, file: File) {
    setSidePhotos(prev => prev.map((sp, i) => i === idx ? { ...sp, uploading: true } : sp));
    try {
      const compressed = await compressPhoto(file);
      const res = await api.upload<{ filename: string }>("/api/vehicle-inspections/photo", compressed);
      setSidePhotos(prev => prev.map((sp, i) => i === idx ? { ...sp, photoPath: res.filename, uploading: false } : sp));
    } catch {
      setSidePhotos(prev => prev.map((sp, i) => i === idx ? { ...sp, uploading: false } : sp));
      setSubmitError("Не удалось загрузить фото — нет связи. Попробуйте ещё раз.");
    }
  }

  // Отправка
  async function handleSubmit() {
    // Валидация: пробег + все пункты чеклиста + чистота + 4 стороны
    const noOdo = !odometer || Number(odometer) <= 0;
    const totalEmpty = [...block1, ...block2, ...block3].filter(it => it.status === "").length;
    const noRigging = rigging.some(it => it.status === "");
    const noClean = cleanItems.some(it => it.status === "");
    const noSidePhotos = sidePhotos.some(sp => !sp.photoPath);
    if (noOdo || totalEmpty > 0 || noRigging || noClean || noSidePhotos) {
      setAttempted(true);
      const parts: string[] = [];
      if (noOdo) parts.push("укажите пробег");
      if (totalEmpty > 0) parts.push(`не отмечено ${totalEmpty} позиц${totalEmpty === 1 ? "ия" : totalEmpty < 5 ? "ии" : "ий"} — подсвечены выше`);
      if (noRigging) parts.push("заполните раздел Такелаж");
      if (noClean) parts.push("укажите чистоту салона и внешнего вида");
      if (noSidePhotos) parts.push("добавьте фото со всех 4 сторон");
      setSubmitError(parts.map((p, i) => i === 0 ? p[0].toUpperCase() + p.slice(1) : p).join("; "));
      return;
    }

    setStep("submitting");
    setSubmitError(null);

    const truckId = selectedTruckId ?? (activeSession?.truck_id ?? 0);

    const items = [
      ...block1.map((it, _i) => ({ block: 1, label: it.label, status: it.status, note: it.note, item_count: null })),
      ...block2.map((it, i) => ({ block: 2, label: it.label, status: it.status, note: it.note, item_count: it.label === "Путевые листы" ? (it.count ?? null) : null })),
      ...block3.map((it) => ({ block: 3, label: it.label, status: it.status, note: it.note, item_count: null })),
      ...rigging.map((it) => ({ block: 5, label: it.label, status: it.status, note: "", item_count: it.qty ? Number(it.qty) : null })),
      ...cleanItems.map((it) => ({ block: 4, label: it.label, status: it.status, note: "", item_count: null })),
    ];

    const dmgs = [
      ...damages.filter(d => d.description.trim() || d.photoPath).map(d => ({ description: d.description, photo_path: d.photoPath ?? "" })),
      ...cleanItems.filter(it => it.photoPath).map(it => ({ description: `Фото чистоты: ${it.label}`, photo_path: it.photoPath! })),
      ...sidePhotos.filter(sp => sp.photoPath).map(sp => ({ description: `4 стороны: ${sp.label}`, photo_path: sp.photoPath! })),
      ...[...block1, ...block2, ...block3].filter(it => it.photoPath).map(it => ({ description: `Примечание фото: ${it.label}`, photo_path: it.photoPath! })),
    ];

    try {
      await api.post("/api/vehicle-inspections/", {
        truck_id: truckId,
        kind,
        odometer: odometer ? Number(odometer) : null,
        items,
        damages: dmgs,
      });
      setStep("ok");
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Ошибка отправки");
      setStep("form");
    }
  }

  const selectedTruck = trucks.find(t => t.id === selectedTruckId) ?? null;

  // ── Шаг: выбор авто ──
  if (step === "select") {
    return (
      <div>
        <SheetHeader title="Принять машину" onClose={onClose} />
        <div style={{ fontSize: 13, color: C.ink2, marginBottom: 16 }}>
          Выберите автомобиль, который принимаете в начале смены
        </div>
        {sessLoading ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: C.ink2 }}>Загрузка...</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {trucks.map(t => {
              const occupiedBy = activeSessions.find(s => s.truck_id === t.id);
              const busy = !!occupiedBy;
              return (
                <button
                  key={t.id}
                  disabled={busy}
                  onClick={() => selectTruck(t.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    background: busy ? C.bg : C.card,
                    border: `1.5px solid ${busy ? C.border : C.iris}`,
                    borderRadius: 14,
                    padding: "14px 16px",
                    cursor: busy ? "not-allowed" : "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    opacity: busy ? 0.65 : 1,
                    width: "100%",
                  }}
                >
                  <div style={{
                    width: 42, height: 42, borderRadius: 11,
                    background: busy ? C.border : C.iris,
                    display: "grid", placeItems: "center",
                    flexShrink: 0,
                    fontSize: 20,
                  }}>
                    🚛
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: C.ink }}>
                      {t.plate || t.label}
                    </div>
                    {t.label && t.plate && (
                      <div style={{ fontSize: 12, color: C.ink2 }}>{t.label}</div>
                    )}
                  </div>
                  {busy ? (
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: C.warn,
                      background: `${C.warn}18`, padding: "3px 8px", borderRadius: 6,
                    }}>
                      Занята
                    </span>
                  ) : (
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: C.good,
                      background: `${C.good}18`, padding: "3px 8px", borderRadius: 6,
                    }}>
                      Свободна
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <MBtn onClick={onClose} solid={false} style={{ marginTop: 16 }}>Отмена</MBtn>
      </div>
    );
  }

  // ── Шаг: успех ──
  if (step === "ok") {
    const newSession: ActiveSession = kind === "start" && selectedTruckId !== null
      ? {
          session_id: 0,
          truck_id: selectedTruckId,
          truck_label: selectedTruck?.label ?? "",
          truck_plate: selectedTruck?.plate ?? "",
          started_at: new Date().toISOString(),
        }
      : null;
    return (
      <div style={{ textAlign: "center", padding: "28px 0" }}>
        <div style={{
          width: 72, height: 72, borderRadius: 20,
          background: kind === "start" ? `${C.good}18` : "#6b6e7a18",
          display: "grid", placeItems: "center",
          margin: "0 auto 16px",
          fontSize: 40,
        }}>
          {kind === "start" ? "✅" : "🔑"}
        </div>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          {kind === "start" ? "Машина принята!" : "Машина сдана!"}
        </div>
        <div style={{ fontSize: 13, color: C.ink2, marginBottom: 24 }}>
          {kind === "start"
            ? `Вы приняли ${selectedTruck?.plate || ""}. Акт записан.`
            : "Акт сдачи записан. Смена завершена."}
        </div>
        <MBtn onClick={() => onDone(newSession)}>Закрыть</MBtn>
      </div>
    );
  }

  // ── Шаг: форма (4 блока) ──
  const title = kind === "start"
    ? `Принять: ${selectedTruck?.plate || "авто"}`
    : `Сдать: ${activeSession?.truck_plate || "авто"}`;

  return (
    <div>
      <SheetHeader title={title} onClose={onClose} />

      {/* Блок 0: Пробег */}
      <BlockCard title="Пробег (одометр)">
        <input
          type="number" inputMode="numeric"
          style={{
            ...inputStyle,
            borderColor: attempted && (!odometer || Number(odometer) <= 0) ? "#e74c3c" : undefined,
            boxShadow: attempted && (!odometer || Number(odometer) <= 0) ? "0 0 0 2px rgba(231,76,60,.2)" : undefined,
          }}
          value={odometer} onChange={e => setOdometer(e.target.value)}
          placeholder="км, например 281 500"
        />
      </BlockCard>

      {/* Блок 1: Состояние авто */}
      <BlockCard title="Состояние автомобиля">
        {block1.map((it, i) => (
          <CheckRow key={it.label} item={it}
            onYes={() => toggleStatus(block1, setBlock1, i, "yes")}
            onNo={() => toggleStatus(block1, setBlock1, i, "no")}
            onNote={note => setNote(setBlock1, i, note)}
            onPhoto={file => uploadItemPhoto(setBlock1, i, file)}
            invalid={attempted && it.status === ""}
          />
        ))}
        {/* Повреждения */}
        <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.ink2, textTransform: "uppercase", letterSpacing: 0.4 }}>
              Повреждения
            </span>
            <button
              onClick={addDamage}
              style={{
                background: C.irisLight, border: "none", color: C.iris,
                borderRadius: 8, padding: "5px 12px", fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              + Добавить
            </button>
          </div>
          {damages.length === 0 && (
            <div style={{ fontSize: 13, color: C.ink2, padding: "8px 0" }}>
              Нет повреждений
            </div>
          )}
          {damages.map(dmg => (
            <DamageRow
              key={dmg.id}
              dmg={dmg}
              uploading={uploadingDmgId === dmg.id}
              onDescChange={desc => setDmgDesc(dmg.id, desc)}
              onRemove={() => removeDamage(dmg.id)}
              onPhotoClick={() => {
                if (fileRef.current) {
                  fileRef.current.dataset.dmgid = dmg.id;
                  fileRef.current.click();
                }
              }}
            />
          ))}
          {/* Скрытый input для фото */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={async e => {
              const file = e.target.files?.[0];
              const dmgId = fileRef.current?.dataset.dmgid;
              if (file && dmgId) {
                await uploadPhoto(dmgId, file);
              }
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
        </div>
      </BlockCard>

      {/* Блок 2: Документы */}
      <BlockCard title="Документы">
        {block2.map((it, i) => (
          <CheckRow key={it.label} item={it}
            onYes={() => toggleStatus(block2, setBlock2, i, "yes")}
            onNo={() => toggleStatus(block2, setBlock2, i, "no")}
            onNote={note => setNote(setBlock2, i, note)}
            onPhoto={file => uploadItemPhoto(setBlock2, i, file)}
            showCount={it.label === "Путевые листы"}
            onCount={count => setCount(setBlock2, i, count)}
            invalid={attempted && it.status === ""}
          />
        ))}
      </BlockCard>

      {/* Блок 3: Комплектация */}
      <BlockCard title="Комплектация">
        {equipLoading ? (
          <div style={{ textAlign: "center", padding: "16px 0", color: C.ink2, fontSize: 13 }}>
            Загрузка списка...
          </div>
        ) : block3.map((it, i) => (
          <CheckRow key={it.label} item={it}
            onYes={() => toggleStatus(block3, setBlock3, i, "yes")}
            onNo={() => toggleStatus(block3, setBlock3, i, "no")}
            onNote={note => setNote(setBlock3, i, note)}
            onPhoto={file => uploadItemPhoto(setBlock3, i, file)}
            invalid={attempted && it.status === ""}
          />
        ))}
      </BlockCard>

      {/* Блок 5: Такелаж */}
      <BlockCard title="Такелаж">
        {rigging.map((it, i) => (
          <CheckRow
            key={it.label}
            item={{ label: it.label, status: it.status, note: "", count: it.qty ? Number(it.qty) : undefined }}
            onYes={() => toggleRigging(i, "yes")}
            onNo={() => toggleRigging(i, "no")}
            onNote={() => {}}
            showCount
            onCount={qty => setRiggingQty(i, qty)}
            countPlaceholder="Количество штук"
            invalid={attempted && it.status === ""}
          />
        ))}
      </BlockCard>

      {/* Блок 4: Чистота */}
      <BlockCard title="Чистота">
        {cleanItems.map((it, i) => (
          <CleanRow
            key={it.label}
            item={it}
            onChange={status => setCleanItems(prev => prev.map((c, ci) => ci === i ? { ...c, status } : c))}
            onPhoto={file => uploadCleanPhoto(i, file)}
            invalid={attempted && it.status === ""}
          />
        ))}
      </BlockCard>

      {/* Блок 5: Фото с 4 сторон */}
      <BlockCard title="Фотографии с 4 сторон">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {sidePhotos.map((sp, i) => (
            <div key={sp.key}>
              <input
                ref={el => { sideFileRefs.current[i] = el; }}
                type="file" accept="image/*" capture="environment"
                style={{ display: "none" }}
                onChange={async e => {
                  const f = e.target.files?.[0];
                  if (f) await uploadSidePhoto(i, f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => sideFileRefs.current[i]?.click()}
                style={{
                  width: "100%", padding: "16px 8px",
                  borderRadius: 12,
                  border: `2px solid ${attempted && !sp.photoPath ? "#e74c3c" : sp.photoPath ? C.good : C.card}`,
                  background: sp.photoPath ? "rgba(39,174,96,.07)" : attempted && !sp.photoPath ? "rgba(231,76,60,.05)" : C.card,
                  color: sp.photoPath ? C.good : attempted && !sp.photoPath ? "#e74c3c" : C.ink2,
                  fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 4,
                  transition: "border-color .2s, background .2s",
                }}
              >
                <span style={{ fontSize: 22 }}>
                  {sp.uploading ? "⏳" : sp.photoPath ? "✅" : "📷"}
                </span>
                <span>{sp.label}</span>
                {sp.photoPath && <span style={{ fontSize: 11 }}>ок</span>}
              </button>
            </div>
          ))}
        </div>
      </BlockCard>

      {submitError && (
        <div style={{
          background: "rgba(231,76,60,.08)", borderRadius: 10,
          padding: "10px 14px", color: "#e74c3c", fontSize: 13, marginBottom: 12,
        }}>
          {submitError}
        </div>
      )}

      <button
        disabled={step === "submitting"}
        onClick={handleSubmit}
        style={{
          display: "block", width: "100%",
          padding: "15px", borderRadius: 14, border: "none",
          background: step === "submitting" ? C.ink2 : C.dark,
          color: "#fff", fontSize: 16, fontWeight: 700,
          cursor: step === "submitting" ? "not-allowed" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {step === "submitting"
          ? "Сохранение..."
          : kind === "start" ? "✅  Принять машину" : "🔑  Сдать машину"}
      </button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TruckInfoSheet — сводка по машине: данные + документы
// ══════════════════════════════════════════════════════════════════════════════

function TruckInfoSheet({ info, onClose }: { info: TruckInfo; onClose: () => void }) {
  function fmtDocDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  const docs: Array<{ title: string; doc: TruckDoc }> = [
    { title: "СТС", doc: info.sts },
    { title: "ОСАГО", doc: info.osago },
    { title: "Карта ТехОсмотра", doc: info.tech_inspection },
  ];

  return (
    <div>
      <SheetHeader title="Информация об автомобиле" onClose={onClose} />

      {/* Сводка: плашка */}
      <div style={{
        background: C.card, borderRadius: 14, padding: "14px 16px",
        marginBottom: 12, border: `1px solid ${C.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, background: C.irisLight,
            display: "grid", placeItems: "center", fontSize: 20, flexShrink: 0,
          }}>🚛</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: C.ink }}>
              {info.plate}
            </div>
            {info.brand && (
              <div style={{ fontSize: 13, color: C.ink2 }}>
                {info.brand}{info.year ? ` · ${info.year}` : ""}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {info.body_type && (
            <div style={{ fontSize: 12 }}>
              <span style={{ color: C.ink2 }}>Кузов: </span>
              <span style={{ color: C.ink, fontWeight: 600 }}>{info.body_type}</span>
            </div>
          )}
          {info.vin && (
            <div style={{ fontSize: 12 }}>
              <span style={{ color: C.ink2 }}>VIN: </span>
              <span style={{ color: C.ink, fontWeight: 600 }}>{info.vin}</span>
            </div>
          )}
        </div>
      </div>

      {/* Документы */}
      <div style={{ fontSize: 11, fontWeight: 700, color: C.ink2, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        Документы
      </div>
      {docs.map(({ title, doc }) => (
        <div key={title} style={{
          background: C.card, borderRadius: 14, padding: "12px 14px",
          marginBottom: 10, border: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          {/* Иконка */}
          <div style={{
            width: 36, height: 36, borderRadius: 9, background: C.irisLight,
            display: "grid", placeItems: "center", flexShrink: 0,
          }}>
            <DocIcon />
          </div>
          {/* Текст: номер + дата */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: C.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 }}>
              {title}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, lineHeight: 1.3 }}>
              {doc.number || <span style={{ color: C.ink2, fontWeight: 400 }}>Номер не указан</span>}
            </div>
            <div style={{ fontSize: 12, color: C.ink2, marginTop: 1 }}>
              {doc.date ? `до ${fmtDocDate(doc.date)}` : "Дата не указана"}
            </div>
          </div>
          {/* Кнопка скачать */}
          {doc.scan_path ? (
            <a
              href={doc.scan_path}
              download
              style={{
                flexShrink: 0, padding: "8px 14px",
                borderRadius: 10, border: "none",
                background: C.iris, color: "#fff",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit", textDecoration: "none",
                display: "inline-block", lineHeight: 1.4,
              }}
            >
              Скачать
            </a>
          ) : (
            <button disabled style={{
              flexShrink: 0, padding: "8px 14px",
              borderRadius: 10, border: `1px solid ${C.border}`,
              background: C.card, color: C.ink2,
              fontSize: 13, fontWeight: 600, cursor: "not-allowed",
              fontFamily: "inherit", opacity: 0.7,
            }}>
              Нет файла
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── BlockCard ──
function BlockCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{
      background: C.bg,
      borderRadius: 14,
      padding: "14px 16px",
      marginBottom: 12,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: C.ink2,
        letterSpacing: 0.8, textTransform: "uppercase",
        marginBottom: 12,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ── InstructionContent ── содержимое инструкции водителя
function InstructionContent() {
  const H = ({ children }: { children: ReactNode }) => (
    <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginTop: 20, marginBottom: 6 }}>
      {children}
    </div>
  );
  const P = ({ children }: { children: ReactNode }) => (
    <p style={{ fontSize: 13, color: C.ink2, lineHeight: 1.55, margin: "0 0 6px" }}>
      {children}
    </p>
  );
  const Li = ({ children }: { children: ReactNode }) => (
    <div style={{ fontSize: 13, color: C.ink2, lineHeight: 1.55, paddingLeft: 14, position: "relative", marginBottom: 4 }}>
      <span style={{ position: "absolute", left: 0 }}>•</span>
      {children}
    </div>
  );
  const Step = ({ n, children }: { n: number; children: ReactNode }) => (
    <div style={{ fontSize: 13, color: C.ink2, lineHeight: 1.55, paddingLeft: 18, position: "relative", marginBottom: 4 }}>
      <span style={{ position: "absolute", left: 0, fontWeight: 600, color: C.iris }}>{n}.</span>
      {children}
    </div>
  );
  const Tag = ({ label, color }: { label: string; color: string }) => (
    <span style={{ background: color + "20", color, borderRadius: 6, fontSize: 11, fontWeight: 700, padding: "2px 7px", marginRight: 4 }}>
      {label}
    </span>
  );
  const Q = ({ q, children }: { q: string; children: ReactNode }) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, marginBottom: 2 }}>{q}</div>
      <div style={{ fontSize: 13, color: C.ink2, lineHeight: 1.55 }}>{children}</div>
    </div>
  );

  return (
    <div style={{ paddingBottom: 4 }}>

      <H>Вход в систему</H>
      <Step n={1}>Откройте приложение в браузере на телефоне.</Step>
      <Step n={2}>Введите <b>логин</b> и <b>пароль</b>, выданные диспетчером.</Step>
      <Step n={3}>Нажмите <b>«Войти»</b>.</Step>
      <P>При первом входе система попросит подтвердить согласие на обработку персональных данных — нажмите <b>«Подтверждаю»</b>. Без этого работа в кабинете недоступна.</P>
      <P><b>Забыли пароль?</b> Нажмите «Забыли пароль?» на экране входа, введите свою электронную почту — ссылка для сброса придёт на почту. Если почта не привязана — обратитесь к диспетчеру.</P>

      <H>Главный экран</H>
      <P>После входа вы попадаете на главный экран. На нём отображается:</P>
      <P><b>Баланс</b> — ваша текущая сумма к получению. Рассчитывается как заработок за незакрытые недели плюс начисленные компенсации и авансы, минус удержания. Нажмите на кнопку 📄 рядом с балансом, чтобы открыть недельную разбивку.</P>
      <P><b>Активная машина</b> — если вы уже приняли машину в начале смены, в верхней части экрана отображается её номер и время принятия. Нажмите на карточку — откроется сводка по машине.</P>
      <P><b>Рейсы</b> — карточка с количеством рейсов и суммой за последнюю неделю. Нажмите, чтобы открыть список своих рейсов.</P>
      <P><b>Четыре кнопки действий:</b></P>
      <Li><b>Пробег +</b> — внести показание одометра</Li>
      <Li><b>Расход +</b> — зафиксировать расход или подать заявку на компенсацию</Li>
      <Li><b>Заявка на ремонт</b> — сообщить о поломке или неисправности</Li>
      <Li><b>Принять / Сдать машину</b> — начать или завершить смену</Li>
      <P><b>Мои компенсации</b> — если у вас есть поданные заявки, они отображаются ниже с текущим статусом («на рассмотрении», «принято», «отказано»).</P>

      <H>Принять машину (начало смены)</H>
      <P>Нажмите <b>«Принять машину»</b>.</P>
      <Step n={1}>Выберите машину из списка. Занятые машины (принятые другим водителем) отмечены серым — выбрать их нельзя.</Step>
      <Step n={2}>Внесите <b>показание одометра</b> (обязательно).</Step>
      <Step n={3}>Заполните чеклист из 5 блоков:</Step>
      <Li><b>Блок 1 — Состояние автомобиля.</b> Для каждого пункта (кузов, стёкла, шины и т.д.) нажмите <b>ДА</b> или <b>НЕТ</b>. Если нужно — нажмите 📝, чтобы добавить примечание и/или прикрепить фото 📷.</Li>
      <Li><b>Блок 2 — Документы.</b> Проверьте наличие СТС, страховки, путевых листов и других документов. Для путевых листов укажите количество.</Li>
      <Li><b>Блок 3 — Оборудование кабины.</b> Огнетушитель, аптечка, знак аварийной остановки и прочее.</Li>
      <Li><b>Блок 4 — Чистота.</b> Для каждой зоны выберите: «Чисто» / «Средне» / «Грязно». Можно прикрепить фото.</Li>
      <Li><b>Блок 5 — Такелаж.</b> Отметьте наличие и состояние цепей, ремней, строп. Нажмите <b>ДА</b> / <b>НЕТ</b>.</Li>
      <Step n={4}>Если есть видимые <b>повреждения</b> — нажмите «+ Добавить повреждение», опишите и при необходимости сфотографируйте.</Step>
      <Step n={5}>Сделайте <b>фото 4 сторон</b> машины (передняя, задняя, левый бок, правый бок) — кнопки расположены в соответствующем блоке.</Step>
      <Step n={6}>Нажмите <b>«Принять машину»</b>.</Step>
      <P>После отправки формируется акт приёмки, который фиксируется в журнале.</P>

      <H>Сдать машину (конец смены)</H>
      <P>Нажмите <b>«Сдать машину»</b> (кнопка появляется вместо «Принять машину», пока машина у вас).</P>
      <P>Процедура аналогична приёмке: те же 5 блоков чеклиста, одометр, фото сторон. После отправки сессия закрывается, машина становится доступна для других водителей.</P>

      <H>Пробег +</H>
      <P>Используйте, чтобы внести показание одометра без приёмки/сдачи (например, в течение смены).</P>
      <Step n={1}>Нажмите <b>«Пробег +»</b>.</Step>
      <Step n={2}>Выберите машину.</Step>
      <Step n={3}>Введите текущий <b>одометр</b> (км).</Step>
      <Step n={4}>Если проводилось техническое обслуживание — поставьте галочку «ТО/сервис».</Step>
      <Step n={5}>При необходимости добавьте примечание.</Step>
      <Step n={6}>Нажмите <b>«Сохранить»</b>.</Step>

      <H>Расход +</H>
      <P><b>Зафиксировать расход</b> — если вы потратили деньги компании (топливо из кармана, мелкий ремонт и т.п.) и хотите записать это как расход:</P>
      <Step n={1}>Нажмите <b>«Расход +»</b>.</Step>
      <Step n={2}>Переключатель оставьте на <b>«Расход»</b>.</Step>
      <Step n={3}>Выберите машину, дату, категорию, введите сумму.</Step>
      <Step n={4}>При наличии чека — прикрепите фото.</Step>
      <Step n={5}>Нажмите <b>«Сохранить»</b>.</Step>
      <div style={{ height: 8 }} />
      <P><b>Подать заявку на компенсацию</b> — если вы хотите, чтобы потраченные деньги вернули вам, переключите на «Компенсация». После одобрения диспетчером сумма будет начислена на ваш баланс:</P>
      <Step n={1}>Нажмите <b>«Расход +»</b> → переключите на <b>«Компенсация»</b>.</Step>
      <Step n={2}>Заполните поля: машина, дата, категория, сумма, описание.</Step>
      <Step n={3}>Прикрепите фото документа/чека (рекомендуется).</Step>
      <Step n={4}>Нажмите <b>«Отправить заявку»</b>.</Step>
      <P>Статус заявки отображается в блоке «Мои компенсации» на главном экране.</P>

      <H>Заявка на ремонт</H>
      <P>Используйте при любой поломке или неисправности, требующей внимания механика.</P>
      <Step n={1}>Нажмите <b>«Заявка на ремонт»</b>.</Step>
      <Step n={2}>Выберите машину.</Step>
      <Step n={3}>Укажите <b>срочность:</b></Step>
      <Li><Tag label="Обычная" color="#27ae60" /> — плановый ремонт, машина на ходу</Li>
      <Li><Tag label="Срочная" color="#d99a3a" /> — нужно устранить в ближайшее время</Li>
      <Li><Tag label="Критическая" color="#e74c3c" /> — машина не может продолжать движение</Li>
      <Step n={4}>Опишите неисправность в поле «Описание».</Step>
      <Step n={5}>При необходимости прикрепите фото.</Step>
      <Step n={6}>Нажмите <b>«Отправить»</b>.</Step>
      <P>Заявка уходит диспетчеру и механику.</P>

      <H>Мои рейсы</H>
      <P>Нажмите на карточку <b>«Рейсы»</b> на главном экране. Откроется список ваших рейсов за последнюю неделю с суммами и статусами. При необходимости сообщите диспетчеру, если видите расхождения.</P>

      <H>Баланс и история выплат</H>
      <P>На главном экране отображается текущий баланс. Нажмите 📄 (кнопка рядом с суммой), чтобы открыть <b>недельную разбивку</b>: сколько заработано за каждую неделю, что уже выплачено, что ещё нет.</P>
      <P>В балансе учитываются:</P>
      <Li>Заработок по рейсам (процент от суммы рейсов)</Li>
      <Li>Компенсации (одобренные заявки)</Li>
      <Li>Авансы (начисляются диспетчером)</Li>
      <Li>Штрафы (ГИБДД или от компании — если были)</Li>

      <H>Профиль и смена пароля</H>
      <P>Нажмите на <b>аватар</b> (круг с вашей буквой) в правом верхнем углу. Откроется карточка профиля: ваше имя, роль, привязанная машина (если назначена).</P>
      <P>Чтобы <b>сменить пароль:</b></P>
      <Step n={1}>Нажмите «Сменить пароль».</Step>
      <Step n={2}>Введите текущий пароль, затем новый дважды.</Step>
      <Step n={3}>Нажмите «Сохранить».</Step>

      <H>Частые вопросы</H>
      <Q q="Не могу выбрать машину — она серая.">Машина уже принята другим водителем. Дождитесь, пока её сдадут, или обратитесь к диспетчеру.</Q>
      <Q q="Не отправляется чеклист — кнопка не работает.">Не все пункты заполнены. Пункты с красной полосой слева — обязательные, нажмите ДА или НЕТ по каждому.</Q>
      <Q q="Баланс показывает минус.">Сумма удержаний (штрафы, авансы) превысила заработок. Уточните детали у диспетчера — нажмите 📄 для подробной разбивки.</Q>
      <Q q="Нет кнопки «Принять машину».">Возможно, вы уже приняли машину (тогда будет кнопка «Сдать»). Если нет — обратитесь к диспетчеру.</Q>
    </div>
  );
}

// ── CheckRow ── пункт чеклиста YES / NO / 📝
function CheckRow({
  item, onYes, onNo, onNote, onPhoto, showCount, onCount, countPlaceholder, invalid,
}: {
  item: CheckItem;
  onYes: () => void;
  onNo: () => void;
  onNote: (n: string) => void;
  onPhoto?: (f: File) => void;
  showCount?: boolean;
  onCount?: (c: string) => void;
  countPlaceholder?: string;
  invalid?: boolean;
}) {
  const [showNote, setShowNote] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const btnBase: React.CSSProperties = {
    border: "none", borderRadius: 8, padding: "7px 14px",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
    fontFamily: "inherit", transition: "background .1s",
    minWidth: 44, minHeight: 36,
  };
  return (
    <div style={{
      marginBottom: 10,
      borderLeft: invalid ? "3px solid #e74c3c" : "3px solid transparent",
      paddingLeft: invalid ? 8 : 8,
      background: invalid ? "rgba(231,76,60,.05)" : "transparent",
      borderRadius: invalid ? 8 : 0,
      transition: "background .2s, border-color .2s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, fontSize: 14, color: C.ink }}>{item.label}</div>
        <button
          onClick={onYes}
          style={{
            ...btnBase,
            background: item.status === "yes" ? C.good : C.card,
            color: item.status === "yes" ? "#fff" : C.ink2,
          }}
        >
          ДА
        </button>
        <button
          onClick={onNo}
          style={{
            ...btnBase,
            background: item.status === "no" ? "#e74c3c" : C.card,
            color: item.status === "no" ? "#fff" : C.ink2,
          }}
        >
          НЕТ
        </button>
        <button
          onClick={() => setShowNote(p => !p)}
          title="Примечание"
          style={{
            ...btnBase,
            background: (showNote || item.note || item.photoPath) ? C.irisLight : C.card,
            color: (showNote || item.note || item.photoPath) ? C.iris : C.ink2,
            padding: "7px 10px",
          }}
        >
          📝
        </button>
      </div>
      {(showNote || item.note || item.photoPath) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
          <input
            type="text"
            placeholder="Примечание..."
            value={item.note}
            onChange={e => onNote(e.target.value)}
            style={{ ...inputStyle, marginBottom: 0, fontSize: 13, flex: 1 }}
          />
          {onPhoto && (
            <>
              <button
                type="button"
                title="Прикрепить фото"
                onClick={() => photoRef.current?.click()}
                style={{
                  ...btnBase,
                  padding: "7px 10px",
                  background: item.photoPath ? C.irisLight : C.card,
                  color: item.photoPath ? C.iris : C.ink2,
                  flexShrink: 0,
                }}
              >
                {item.photoUploading ? "⏳" : item.photoPath ? "✅" : "📷"}
              </button>
              <input
                ref={photoRef}
                type="file" accept="image/*" capture="environment"
                style={{ display: "none" }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) onPhoto(f);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>
      )}
      {showCount && item.status !== "no" && (
        <input
          type="number" inputMode="numeric"
          placeholder={countPlaceholder ?? "Количество листов"}
          value={item.count !== undefined ? String(item.count) : ""}
          onChange={e => onCount?.(e.target.value)}
          style={{ ...inputStyle, marginTop: 6, marginBottom: 0, fontSize: 13 }}
        />
      )}
    </div>
  );
}

// ── CleanRow ── Чисто / Средне / Грязно + фото
function CleanRow({ item, onChange, onPhoto, invalid }: {
  item: CleanItem;
  onChange: (s: CleanItem["status"]) => void;
  onPhoto: (f: File) => void;
  invalid?: boolean;
}) {
  const cleanFileRef = useRef<HTMLInputElement>(null);
  const btnBase: React.CSSProperties = {
    border: "none", borderRadius: 8, padding: "7px 12px",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
    fontFamily: "inherit", transition: "background .1s", minHeight: 36,
  };
  return (
    <div style={{
      marginBottom: 10,
      borderLeft: invalid ? "3px solid #e74c3c" : "3px solid transparent",
      paddingLeft: 8,
      background: invalid ? "rgba(231,76,60,.05)" : "transparent",
      borderRadius: invalid ? 8 : 0,
      transition: "background .2s, border-color .2s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 80, fontSize: 14, color: C.ink }}>{item.label}</div>
        <button
          onClick={() => onChange(item.status === "clean" ? "" : "clean")}
          style={{ ...btnBase, background: item.status === "clean" ? C.good : C.card, color: item.status === "clean" ? "#fff" : C.ink2 }}
        >Чисто</button>
        <button
          onClick={() => onChange(item.status === "medium" ? "" : "medium")}
          style={{ ...btnBase, background: item.status === "medium" ? "#f39c12" : C.card, color: item.status === "medium" ? "#fff" : C.ink2 }}
        >Средне</button>
        <button
          onClick={() => onChange(item.status === "dirty" ? "" : "dirty")}
          style={{ ...btnBase, background: item.status === "dirty" ? "#e74c3c" : C.card, color: item.status === "dirty" ? "#fff" : C.ink2 }}
        >Грязно</button>
        <button
          onClick={() => cleanFileRef.current?.click()}
          title="Фото"
          style={{ ...btnBase, background: item.photoPath ? C.irisLight : C.card, color: item.photoPath ? C.iris : C.ink2, padding: "7px 10px" }}
        >
          {item.uploading ? "⏳" : item.photoPath ? "✅" : "📷"}
        </button>
        <input
          ref={cleanFileRef}
          type="file" accept="image/*" capture="environment"
          style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ""; }}
        />
      </div>
    </div>
  );
}

// ── DamageRow ──
function DamageRow({
  dmg, uploading, onDescChange, onRemove, onPhotoClick,
}: {
  dmg: DamageEntry;
  uploading: boolean;
  onDescChange: (d: string) => void;
  onRemove: () => void;
  onPhotoClick: () => void;
}) {
  return (
    <div style={{
      background: C.card,
      borderRadius: 12,
      padding: "12px 14px",
      marginBottom: 8,
      border: `1px solid ${C.border}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>Повреждение</span>
        <button onClick={onRemove} style={{
          background: "none", border: "none", cursor: "pointer",
          color: C.ink2, fontSize: 18, lineHeight: 1, padding: 0,
        }}>×</button>
      </div>
      <input
        type="text"
        placeholder="Описание повреждения"
        value={dmg.description}
        onChange={e => onDescChange(e.target.value)}
        style={{ ...inputStyle, marginBottom: 8, fontSize: 13 }}
      />
      <button
        onClick={onPhotoClick}
        disabled={uploading}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          background: dmg.photoPath ? `${C.good}18` : C.bg,
          border: `1px dashed ${dmg.photoPath ? C.good : C.border}`,
          borderRadius: 8, padding: "8px 12px", width: "100%",
          cursor: uploading ? "not-allowed" : "pointer",
          fontFamily: "inherit", fontSize: 13,
          color: dmg.photoPath ? C.good : C.ink2,
        }}
      >
        📷{" "}
        {uploading ? "Загрузка..." : dmg.photoPath ? "Фото прикреплено ✓" : "Прикрепить фото"}
      </button>
    </div>
  );
}

// ---------- Вспомогательные компоненты ----------

function ActionCard({ icon, label, onClick, accent }: {
  icon: string; label: string; onClick: () => void; accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: accent ? `${C.good}12` : C.card,
        border: accent ? `1.5px solid ${C.good}40` : "none",
        borderRadius: C.radius,
        boxShadow: accent ? "none" : C.cardShadow,
        padding: "14px 14px",
        cursor: "pointer",
        textAlign: "left",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 11,
        fontFamily: "inherit",
        WebkitTapHighlightColor: "transparent",
        transition: "transform .12s, box-shadow .12s",
      }}
      onTouchStart={e => {
        e.currentTarget.style.transform = "scale(0.97)";
        e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,.06)";
      }}
      onTouchEnd={e => {
        e.currentTarget.style.transform = "scale(1)";
        e.currentTarget.style.boxShadow = accent ? "none" : C.cardShadow;
      }}
    >
      <div style={{
        width: 44, height: 44, flexShrink: 0, borderRadius: 13,
        background: accent ? C.good : C.dark,
        display: "grid", placeItems: "center",
      }}>
        <span
          style={{
            fontFamily: "'icon-works', sans-serif",
            fontSize: 22,
            color: "#ffffff",
            lineHeight: 1,
            userSelect: "none",
          }}
          dangerouslySetInnerHTML={{ __html: icon }}
        />
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, lineHeight: 1.3 }}>
        {label}
      </div>
    </button>
  );
}

// ---------- Стили форм (мобильные) ----------
const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: "12px 14px",
  fontSize: 15,
  background: C.bg,
  color: C.ink,
  fontFamily: "inherit",
  marginBottom: 16,
  appearance: "none",
};

function MLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, color: C.ink2,
      letterSpacing: 0.5, textTransform: "uppercase",
      marginBottom: 6,
    }}>
      {children}
    </div>
  );
}

function MBtn({ children, onClick, solid, style }: {
  children: ReactNode; onClick: () => void;
  solid?: boolean; style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block", width: "100%",
        padding: "14px", borderRadius: 12, border: "none",
        background: solid !== false ? C.dark : C.bg,
        color: solid !== false ? "#fff" : C.ink,
        fontSize: 15, fontWeight: 600,
        cursor: "pointer", fontFamily: "inherit",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h2>
      <button onClick={onClose} style={{
        background: C.bg, border: "none", borderRadius: 8,
        width: 32, height: 32, display: "grid", placeItems: "center",
        fontSize: 18, cursor: "pointer", color: C.ink2,
      }}>×</button>
    </div>
  );
}

function AmountCell({ label, value, highlight, color }: {
  label: string; value: number; highlight?: boolean; color?: string;
}) {
  const textColor = highlight ? (color ?? "var(--ember,#e74c3c)") : C.ink;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 10, color: C.ink2, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: value > 0 ? textColor : C.ink2 }}>
        {value > 0 ? money(value) : "—"}
      </div>
    </div>
  );
}

function ProfileSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{
      background: C.bg,
      borderRadius: 14,
      padding: "12px 16px",
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: C.ink2,
        letterSpacing: 0.8, textTransform: "uppercase",
        marginBottom: 10,
      }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {children}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <span style={{ fontSize: 13, color: C.ink2, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.ink, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function formatRate(type: string, value: number): string {
  switch (type) {
    case "percentOfNet": return `${value}% от нетто`;
    case "perTrip":      return `${value.toLocaleString("ru-RU")} ₽ за рейс`;
    case "perKm":        return `${value} ₽/км`;
    case "salary":       return `${value.toLocaleString("ru-RU")} ₽/мес`;
    default:             return `${value}`;
  }
}

function ModalContent({
  title, onClose, onSubmit, saving, ok, okMessage, error, children, submitLabel = "Сохранить",
}: {
  title: string; onClose: () => void; onSubmit: () => void;
  saving: boolean; ok: boolean; okMessage: string;
  error: string | null; children: ReactNode; submitLabel?: string;
}) {
  return (
    <div>
      <SheetHeader title={title} onClose={onClose} />
      {ok ? (
        <div style={{ textAlign: "center", padding: "28px 0" }}>
          <div style={{
            width: 64, height: 64, borderRadius: 18,
            background: "#27ae6018", display: "grid", placeItems: "center",
            margin: "0 auto 14px", fontSize: 36,
          }}>✅</div>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 20 }}>{okMessage}</div>
          <MBtn onClick={onClose} solid={false}>Закрыть</MBtn>
        </div>
      ) : (
        <>
          {children}
          {error && (
            <div style={{
              background: "rgba(231,76,60,.08)", borderRadius: 10,
              padding: "10px 14px", color: "#e74c3c", fontSize: 13,
              marginTop: 4,
            }}>
              {error}
            </div>
          )}
          <button
            disabled={saving} onClick={onSubmit}
            style={{
              display: "block", width: "100%",
              padding: "14px", borderRadius: 12, border: "none",
              background: saving ? C.ink2 : C.dark,
              color: "#fff", fontSize: 15, fontWeight: 600,
              cursor: saving ? "not-allowed" : "pointer",
              fontFamily: "inherit", marginTop: 20,
            }}
          >
            {saving ? "Сохранение..." : submitLabel}
          </button>
        </>
      )}
    </div>
  );
}
