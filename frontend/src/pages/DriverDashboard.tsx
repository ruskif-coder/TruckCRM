/**
 * DriverDashboard — редизайн 2026-08.
 * Дизайн-система: src/design-system/ (токены, Onest, JetBrains Mono).
 * Логика и API не изменились.
 */
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import imageCompression from "browser-image-compression";
import { api, ApiError, fileUrl } from "../api";
import { useAuth } from "../auth/AuthContext";
import { isoDate, money } from "../lib/format";
import {
  IconTruck,
  IconClose, IconCamera, IconPlus, IconCheck,
  IconWarning, IconClock, IconLogout,
  IconGauge, IconRuble, IconWrench,
} from "../design-system/icons";

async function compressPhoto(file: File): Promise<File> {
  return imageCompression(file, { maxSizeMB: 1.5, maxWidthOrHeight: 1920, useWebWorker: true });
}

// ── Типы ──────────────────────────────────────────────────────────────────────
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
type DriverTx    = { id: number; date: string; tx_type: string; amount: number; description: string };
type TxData      = { balance_adjustment: number; transactions: DriverTx[] };
type LedgerEntry = { date: string; entry_type: string; amount: number; description: string };
type Truck       = { id: number; label: string; plate: string };
type PaymentTerm = { carrier: string; rate_type: string; rate_value: number };
type ProfileData = {
  last_name: string; first_name: string; middle_name: string;
  passport_number: string; passport_issued_date: string | null;
  license_number: string; license_issued_date: string | null; license_valid_until: string | null;
  skzi_card_number: string; skzi_valid_until: string | null;
  payment_terms: PaymentTerm[];
};
type ActiveSession = {
  session_id: number; truck_id: number;
  truck_label: string; truck_plate: string; started_at: string;
} | null;
type ActiveSessionEntry = { truck_id: number; driver_name: string };
type TruckDoc = { number: string; date: string | null; scan_path: string | null };
type TruckInfo = {
  plate: string; label: string; brand: string; year: number | null;
  body_type: string; vin: string; sts: TruckDoc; osago: TruckDoc; tech_inspection: TruckDoc;
};
type CheckItem   = { label: string; status: "yes" | "no" | ""; note: string; count?: number; photoPath?: string; photoUploading?: boolean };
type DamageEntry = { id: string; description: string; photoFile?: File; photoPath?: string };
type CleanItem   = { label: string; status: "" | "clean" | "medium" | "dirty"; photoPath?: string; uploading?: boolean };
type SidePhoto   = { key: string; label: string; photoPath?: string; uploading?: boolean };
type RiggingItem = { label: string; status: "yes" | "no" | ""; qty: string };
type MyComp      = { id: number; amount: number; category: string; description: string; status: string; created_at: string; reject_reason: string };
type MyRepair    = { id: number; text: string; status: string; priority: string; created_at: string; truck_label: string };
type ExpCat      = { id: number; name: string; allowed_roles: string; active: boolean };

// ── Константы ─────────────────────────────────────────────────────────────────
const EXPENSE_CATEGORIES = ["Ремонт/запчасти","Топливо","Зарплата","Страховка","Прочее"];
const BLOCK1_LABELS = ["Фары передние","Фары задние","Шины передние","Шины задние","Уровень масла","Охлаждающая жидкость"];
const BLOCK2_LABELS = ["СТС","ОСАГО","Карта ТехОсмотра","Топливная карта","Путевые листы"];
const DEFAULT_EQUIPMENT = ["Автономка","Домкрат","Монтажка","Ключ балонный","Набор инструментов","Спецовка","Холодильник"];

function makeItems(labels: string[]): CheckItem[] {
  return labels.map(label => ({ label, status: "", note: "" }));
}

// Фото из /api/vehicle-inspections/photo возвращают bare filename; fileUrl ждёт /photos/name
function photoUrl(filename: string | undefined): string {
  if (!filename) return "";
  return fileUrl(filename.startsWith("/") ? filename : `/photos/${filename}`);
}

// ── Вспомогательные ───────────────────────────────────────────────────────────
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}
function weekLabel(startIso: string | null, endIso?: string | null): string {
  if (!startIso) return "—";
  return `${fmtShort(startIso)} – ${fmtShort(endIso ?? startIso)}`;
}

// ── Shared стили ──────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: "100%", height: 44,
  background: "var(--surface-2)", border: "1px solid var(--line-strong)",
  borderRadius: "var(--r-md)", padding: "0 14px",
  fontFamily: "var(--font-ui)", fontSize: 14, color: "var(--ink)",
};

// ── Переиспользуемые компоненты ───────────────────────────────────────────────

/** Шапка sheet с крестиком */
function SheetHeader({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 20 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.5, color: "var(--ink)" }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3, fontFamily: "var(--font-mono)" }}>{sub}</div>}
      </div>
      <button
        onClick={onClose}
        style={{
          width: 36, height: 36, borderRadius: "50%",
          background: "var(--surface-2)", border: "none",
          display: "grid", placeItems: "center",
          cursor: "pointer", flexShrink: 0, color: "var(--ink)",
        }}
      >
        <IconClose size={16} />
      </button>
    </div>
  );
}

/** Кнопка внутри sheet */
function SBtn({
  children, onClick, variant = "primary", disabled, style,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const map = {
    primary:   { bg: "var(--invert)", color: "var(--on-invert)" },
    secondary: { bg: "var(--surface-2)", color: "var(--ink)" },
    danger:    { bg: "var(--danger-bg)", color: "var(--danger)" },
  };
  const { bg, color } = map[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%", height: 52, borderRadius: "var(--r-md)",
        background: bg, color, border: "none",
        fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 700,
        cursor: "pointer", opacity: disabled ? 0.45 : 1,
        transition: "opacity 140ms",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Экран успеха внутри bottom-sheet (галочка + текст + «Закрыть») */
function SuccessScreen({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div style={{ textAlign: "center", padding: "20px 0" }}>
      <IconCheck size={36} style={{ color: "var(--success)", margin: "0 auto 12px" }} />
      <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>{text}</div>
      <SBtn onClick={onClose}>Закрыть</SBtn>
    </div>
  );
}

/** Блок-карточка в форме */
function BlockCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 10, fontWeight: 600, textTransform: "uppercase",
        letterSpacing: "0.08em", color: "var(--text-4)",
        fontFamily: "var(--font-mono)", marginBottom: 10,
      }}>
        {title}
      </div>
      <div style={{
        background: "var(--surface)", borderRadius: "var(--r-xl)",
        border: "1px solid var(--line)", overflow: "hidden",
      }}>
        {children}
      </div>
    </div>
  );
}

/** Строка чеклиста */
function CheckRow({
  item, onYes, onNo, onNote, onPhoto, invalid,
}: {
  item: CheckItem;
  onYes: () => void; onNo: () => void;
  onNote: (v: string) => void;
  onPhoto: (f: File) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div style={{ borderBottom: "1px solid var(--line-row)" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "13px 16px",
        background: invalid && !item.status ? "var(--danger-bg)" : "transparent",
      }}>
        <span style={{ flex: 1, fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>{item.label}</span>
        {item.count !== undefined && (
          <input
            type="number" inputMode="numeric"
            value={item.count ?? ""}
            onChange={e => onNote(e.target.value)}
            placeholder="0"
            style={{ width: 60, height: 34, ...inputStyle, fontSize: 13 }}
          />
        )}
        <div style={{ display: "flex", gap: 6 }}>
          {["yes","no"].map(v => (
            <button
              key={v}
              onClick={v === "yes" ? onYes : onNo}
              style={{
                width: 52, height: 34, borderRadius: "var(--r-sm)", fontSize: 12, fontWeight: 700,
                border: "none", cursor: "pointer", fontFamily: "var(--font-ui)",
                background: item.status === v
                  ? (v === "yes" ? "var(--invert)" : "var(--danger-bg)")
                  : "var(--surface-2)",
                color: item.status === v
                  ? (v === "yes" ? "var(--on-invert)" : "var(--danger)")
                  : "var(--text-2)",
              }}
            >
              {v === "yes" ? "Да" : "Нет"}
            </button>
          ))}
        </div>
        <button
          onClick={() => setOpen(p => !p)}
          style={{
            width: 34, height: 34, borderRadius: "var(--r-sm)",
            background: "var(--surface-2)", border: "none",
            fontSize: 16, cursor: "pointer", color: "var(--text-2)",
          }}
        >
          ✎
        </button>
      </div>
      {open && (
        <div style={{ padding: "10px 16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            style={{ ...inputStyle, height: 38 }}
            placeholder="Примечание…"
            value={item.note}
            onChange={e => onNote(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input ref={ref} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ""; }}
            />
            <button
              onClick={() => ref.current?.click()}
              style={{
                height: 34, padding: "0 14px", borderRadius: "var(--r-sm)",
                background: "var(--surface-2)", border: "1px solid var(--line)",
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 12, fontWeight: 600, cursor: "pointer", color: "var(--ink)",
              }}
            >
              {item.photoUploading ? <IconClock size={15} /> : <IconCamera size={15} />}
              Фото
            </button>
            {item.photoPath && (
              <img
                src={photoUrl(item.photoPath)}
                alt=""
                style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover" }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Строка повреждения */
function DamageRow({
  dmg, uploading, onDescChange, onRemove, onPhotoClick,
}: {
  dmg: DamageEntry;
  uploading: boolean;
  onDescChange: (v: string) => void;
  onRemove: () => void;
  onPhotoClick: () => void;
}) {
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "flex-start",
      padding: "10px 0", borderTop: "1px solid var(--line-row)",
    }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          style={{ ...inputStyle, height: 38 }}
          placeholder="Описание повреждения"
          value={dmg.description}
          onChange={e => onDescChange(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={onPhotoClick}
            style={{
              height: 32, padding: "0 12px", borderRadius: "var(--r-sm)",
              background: "var(--surface-2)", border: "1px solid var(--line)",
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 12, cursor: "pointer", color: "var(--ink)",
            }}
          >
            {uploading ? <IconClock size={14} /> : <IconCamera size={14} />}
            Фото
          </button>
          {dmg.photoPath && (
            <img src={photoUrl(dmg.photoPath)} alt=""
              style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} />
          )}
        </div>
      </div>
      <button
        onClick={onRemove}
        style={{
          width: 32, height: 32, borderRadius: "50%",
          background: "var(--danger-bg)", border: "none",
          display: "grid", placeItems: "center", cursor: "pointer", flexShrink: 0,
          color: "var(--danger)", marginTop: 3,
        }}
      >
        <IconClose size={14} />
      </button>
    </div>
  );
}

// ── HandoverSheet ─────────────────────────────────────────────────────────────
// Шаги мастера 1..5 (0 = выбор машины при приёмке). STEP_LABELS индексируется
// как step-1, поэтому здесь ровно 5 подписей.
const STEP_LABELS = ["Пробег", "Состояние", "Документы", "Комплектация", "Чистота и такелаж"];
type WizardStep = 0 | 1 | 2 | 3 | 4 | 5 | "ok";

function WizardProgress({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)", marginBottom: 8 }}>
        шаг {step} из {total} · {label}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1, height: 5, borderRadius: 3,
              background: i < step - 1
                ? "var(--invert)"
                : i === step - 1
                ? "var(--accent)"
                : "var(--line-strong)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function HandoverSheet({
  trucks, activeSession, onClose, onDone,
}: {
  trucks: Truck[];
  activeSession: ActiveSession;
  onClose: () => void;
  onDone: (newSession: ActiveSession) => void;
}) {
  const kind = activeSession ? "end" : "start";
  const [step, setStep] = useState<WizardStep>(kind === "start" ? 0 : 1);
  const [selectedTruckId, setSelectedTruckId] = useState<number | null>(activeSession?.truck_id ?? null);
  const [activeSessions, setActiveSessions] = useState<ActiveSessionEntry[]>([]);
  const [sessLoading, setSessLoading] = useState(false);

  const [odometer, setOdometer] = useState("");
  const [block1, setBlock1] = useState<CheckItem[]>(makeItems(BLOCK1_LABELS));
  const [block2, setBlock2] = useState<CheckItem[]>(makeItems(BLOCK2_LABELS));
  const [block2count, setBlock2count] = useState<number[]>(Array(BLOCK2_LABELS.length).fill(0));
  const [equipment, setEquipment] = useState<CheckItem[]>(makeItems(DEFAULT_EQUIPMENT));
  const [cleanItems, setCleanItems] = useState<CleanItem[]>([{ label: "Кузов снаружи", status: "" },{ label: "Кабина внутри", status: "" }]);
  const [rigging, setRigging] = useState<RiggingItem[]>([
    { label: "Ремни (штук)", status: "", qty: "" },
    { label: "Стяжки (штук)", status: "", qty: "" },
    { label: "Уголки", status: "", qty: "" },
  ]);
  const [sidePhotos, setSidePhotos] = useState<SidePhoto[]>([
    { key: "front", label: "Спереди" },
    { key: "back", label: "Сзади" },
    { key: "left", label: "Слева" },
    { key: "right", label: "Справа" },
  ]);
  const [damages, setDamages] = useState<DamageEntry[]>([]);
  const [uploadingDmgId, setUploadingDmgId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sidePhotoRefs = useRef<(HTMLInputElement | null)[]>([]);
  const cleanPhotoRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (kind === "start") {
      setSessLoading(true);
      api.get<ActiveSessionEntry[]>("/api/vehicle-inspections/active-sessions")
        .then(list => setActiveSessions(list))
        .catch(() => {})
        .finally(() => setSessLoading(false));
    }
  }, [kind]);

  function toggleStatus<T extends { status: "yes"|"no"|"" }>(
    _arr: T[], setArr: React.Dispatch<React.SetStateAction<T[]>>, idx: number, val: "yes"|"no"
  ) {
    setArr(prev => prev.map((it, i) => i === idx ? { ...it, status: it.status === val ? "" : val } : it));
  }
  function setNote(setArr: React.Dispatch<React.SetStateAction<CheckItem[]>>, idx: number, note: string) {
    setArr(prev => prev.map((it, i) => i === idx ? { ...it, note } : it));
  }

  // Сжать + загрузить фото акта; вернуть имя файла (или null при ошибке).
  async function uploadInspectionPhoto(file: File): Promise<string | null> {
    try {
      const compressed = await compressPhoto(file);
      const res = await api.upload<{ filename: string }>("/api/vehicle-inspections/photo", compressed);
      return res.filename;
    } catch {
      return null;
    }
  }

  async function uploadItemPhoto(
    setArr: React.Dispatch<React.SetStateAction<CheckItem[]>>, idx: number, file: File
  ) {
    setArr(prev => prev.map((it, i) => i === idx ? { ...it, photoUploading: true } : it));
    const filename = await uploadInspectionPhoto(file);
    setArr(prev => prev.map((it, i) => i === idx
      ? { ...it, photoPath: filename ?? it.photoPath, photoUploading: false } : it));
  }

  async function uploadSidePhoto(idx: number, file: File) {
    setSidePhotos(prev => prev.map((it, i) => i === idx ? { ...it, uploading: true } : it));
    const filename = await uploadInspectionPhoto(file);
    setSidePhotos(prev => prev.map((it, i) => i === idx
      ? { ...it, photoPath: filename ?? it.photoPath, uploading: false } : it));
  }

  async function uploadCleanPhoto(idx: number, file: File) {
    setCleanItems(prev => prev.map((it, i) => i === idx ? { ...it, uploading: true } : it));
    const filename = await uploadInspectionPhoto(file);
    setCleanItems(prev => prev.map((it, i) => i === idx
      ? { ...it, photoPath: filename ?? it.photoPath, uploading: false } : it));
  }

  function addDamage() {
    setDamages(prev => [...prev, { id: String(Date.now()), description: "" }]);
  }
  function removeDamage(id: string) {
    setDamages(prev => prev.filter(d => d.id !== id));
  }
  function setDmgDesc(id: string, desc: string) {
    setDamages(prev => prev.map(d => d.id === id ? { ...d, description: desc } : d));
  }

  async function selectTruck(id: number) {
    setSelectedTruckId(id);
    setStep(1);
  }

  async function handleSubmit() {
    const truckId = selectedTruckId ?? activeSession?.truck_id;
    if (!truckId) return;
    // Валидация полноты акта: пробег + все пункты чеклиста + чистота + такелаж
    // + фото 4 сторон. Гард был утерян при рефакторинге 1.5.0 — из-за этого
    // пустой акт «проходил» (все status="") и сессия открывалась пустой.
    const noOdo = !odometer || Number(odometer) <= 0;
    const totalEmpty = [...block1, ...block2, ...equipment].filter(it => it.status === "").length;
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
      if (noOdo) setStep(1);
      return;
    }
    const allItems = [
      ...block1.map(it => ({ block: 1, label: it.label, status: it.status, note: it.note ?? "" })),
      ...block2.map((it, i) => ({ block: 2, label: it.label, status: it.status, note: it.note ?? "", item_count: block2count[i] || null })),
      ...equipment.map(it => ({ block: 3, label: it.label, status: it.status, note: it.note ?? "" })),
      ...cleanItems.map(it => ({ block: 4, label: it.label, status: it.status, note: "" })),
      ...rigging.map(it => ({ block: 5, label: it.label, status: it.status, note: it.qty ?? "" })),
    ];
    const dmgs = damages.filter(d => d.description.trim()).map(d => ({
      description: d.description, photo_path: d.photoPath ?? "",
    }));
    const sidePhotoItems = sidePhotos.map(p => ({ key: p.key, label: p.label, photoPath: p.photoPath }));
    setSubmitting(true); setSubmitError(null);
    try {
      await api.post("/api/vehicle-inspections/", {
        truck_id: truckId, kind, odometer: odometer ? Number(odometer) : null,
        items: allItems, damages: dmgs, side_photos: sidePhotoItems,
      });
      setStep("ok");
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Ошибка отправки");
      setStep(1);
    } finally { setSubmitting(false); }
  }

  const selectedTruck = trucks.find(t => t.id === selectedTruckId) ?? null;
  const plateLabel = activeSession?.truck_plate || selectedTruck?.plate || "авто";

  // ── Шаг 0: выбор авто (только start) ──
  if (step === 0) {
    return (
      <div>
        <SheetHeader title="Принять машину" onClose={onClose} />
        <p style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 16 }}>
          Выберите автомобиль, который принимаете в начале смены
        </p>
        {sessLoading ? (
          <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-3)" }}>Загрузка…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {trucks.map(t => {
              const busy = activeSessions.some(s => s.truck_id === t.id);
              return (
                <button
                  key={t.id}
                  disabled={busy}
                  onClick={() => selectTruck(t.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 14,
                    background: busy ? "var(--surface-2)" : "var(--surface)",
                    border: `1.5px solid ${busy ? "var(--line)" : "var(--invert)"}`,
                    borderRadius: "var(--r-lg)", padding: "14px 16px",
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.6 : 1,
                    width: "100%", textAlign: "left", fontFamily: "var(--font-ui)",
                  }}
                >
                  <div style={{
                    width: 42, height: 42, borderRadius: "var(--r-sm)",
                    background: busy ? "var(--surface-3)" : "var(--invert)",
                    display: "grid", placeItems: "center", flexShrink: 0,
                    color: busy ? "var(--text-3)" : "var(--on-invert)",
                  }}>
                    <IconTruck size={20} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)", fontFamily: "var(--font-mono)" }}>
                      {t.plate || t.label}
                    </div>
                    {t.label && t.plate && (
                      <div style={{ fontSize: 12, color: "var(--text-2)" }}>{t.label}</div>
                    )}
                  </div>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "3px 9px",
                    borderRadius: "var(--r-xs)",
                    background: busy ? "var(--warn-bg)" : "var(--success-bg)",
                    color: busy ? "var(--warn)" : "var(--success)",
                  }}>
                    {busy ? "Занята" : "Свободна"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <SBtn variant="secondary" onClick={onClose} style={{ marginTop: 16 }}>Отмена</SBtn>
      </div>
    );
  }

  // ── Шаг: успех ──
  if (step === "ok") {
    const newSession: ActiveSession = kind === "start" && selectedTruckId !== null
      ? { session_id: 0, truck_id: selectedTruckId, truck_label: selectedTruck?.label ?? "",
          truck_plate: selectedTruck?.plate ?? "", started_at: new Date().toISOString() }
      : null;
    return (
      <div style={{ textAlign: "center", padding: "28px 0" }}>
        <div style={{
          width: 72, height: 72, borderRadius: 20, margin: "0 auto 20px",
          background: kind === "start" ? "var(--success-bg)" : "var(--surface-2)",
          display: "grid", placeItems: "center",
          color: kind === "start" ? "var(--success)" : "var(--text-2)",
        }}>
          <IconCheck size={32} />
        </div>
        <div style={{ fontWeight: 700, fontSize: 20, letterSpacing: -0.5, marginBottom: 8, color: "var(--ink)" }}>
          {kind === "start" ? "Машина принята!" : "Машина сдана!"}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 28 }}>
          {kind === "start"
            ? `Вы приняли ${selectedTruck?.plate || ""}. Акт записан.`
            : "Акт сдачи записан. Смена завершена."}
        </div>
        <SBtn onClick={() => onDone(newSession)}>Закрыть</SBtn>
      </div>
    );
  }

  // ── Мастер: шаги 1–5 ──
  const title = kind === "start" ? `Принять: ${plateLabel}` : `Сдать: ${plateLabel}`;

  return (
    <div>
      <SheetHeader title={title} onClose={onClose} />
      <WizardProgress step={step as number} total={STEP_LABELS.length} label={STEP_LABELS[(step as number) - 1] ?? ""} />

      {/* Шаг 1: Пробег */}
      {step === 1 && (
        <>
          <BlockCard title="Пробег (одометр)">
            <div style={{ padding: "14px 16px" }}>
              <input
                type="number" inputMode="numeric"
                style={{
                  ...inputStyle,
                  borderColor: attempted && (!odometer || Number(odometer) <= 0) ? "var(--danger)" : undefined,
                }}
                value={odometer}
                onChange={e => setOdometer(e.target.value)}
                placeholder="км, например 281 500"
                autoFocus
              />
            </div>
          </BlockCard>

          {/* Фото 4 сторон */}
          <BlockCard title="Фото автомобиля — 4 стороны">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 14 }}>
              {sidePhotos.map((sp, i) => (
                <div key={sp.key}>
                  <input
                    ref={el => { sidePhotoRefs.current[i] = el; }}
                    type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadSidePhoto(i, f); e.target.value = ""; }}
                  />
                  <button
                    onClick={() => sidePhotoRefs.current[i]?.click()}
                    style={{
                      width: "100%", aspectRatio: "4/3", borderRadius: "var(--r-md)",
                      border: sp.photoPath ? "2px solid var(--accent)" : "1.5px dashed rgba(0,0,0,.2)",
                      background: sp.photoPath ? "var(--row-selected)" : "var(--surface-2)",
                      display: "flex", flexDirection: "column", alignItems: "center",
                      justifyContent: "center", gap: 6, cursor: "pointer", overflow: "hidden",
                    }}
                  >
                    {sp.photoPath ? (
                      <img src={photoUrl(sp.photoPath)} alt={sp.label}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : sp.uploading ? (
                      <>
                        <IconClock size={22} style={{ color: "var(--text-3)" }} />
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>Загрузка…</span>
                      </>
                    ) : (
                      <>
                        <IconCamera size={22} style={{ color: "var(--text-3)" }} />
                        <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{sp.label}</span>
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </BlockCard>

          {/* Повреждения */}
          <BlockCard title="Повреждения">
            <div style={{ padding: "0 16px 14px" }}>
              {damages.length === 0 && (
                <div style={{ padding: "14px 0 6px", fontSize: 13, color: "var(--text-3)" }}>
                  Нет повреждений
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                onChange={async e => {
                  const f = e.target.files?.[0]; if (!f) return;
                  const dmgId = e.target.dataset.dmgid;
                  if (!dmgId) return;
                  setUploadingDmgId(dmgId);
                  try {
                    const compressed = await compressPhoto(f);
                    const res = await api.upload<{ filename: string }>("/api/vehicle-inspections/photo", compressed);
                    setDamages(prev => prev.map(d => d.id === dmgId ? { ...d, photoPath: res.filename } : d));
                  } catch { /* игнорируем */ } finally { setUploadingDmgId(null); }
                  e.target.value = "";
                }}
              />
              {damages.map(dmg => (
                <DamageRow key={dmg.id} dmg={dmg} uploading={uploadingDmgId === dmg.id}
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
              <button
                onClick={addDamage}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  marginTop: 10, padding: "8px 0", background: "none", border: "none",
                  fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--ink)",
                  fontFamily: "var(--font-ui)",
                }}
              >
                <IconPlus size={16} /> Добавить повреждение
              </button>
            </div>
          </BlockCard>

          <SBtn onClick={() => { setAttempted(true); if (odometer && Number(odometer) > 0) setStep(2); }}>
            Далее · состояние
          </SBtn>
        </>
      )}

      {/* Шаг 2: Состояние автомобиля */}
      {step === 2 && (
        <>
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
          </BlockCard>
          <div style={{ display: "flex", gap: 10 }}>
            <SBtn variant="secondary" onClick={() => setStep(1)} style={{ flex: 1 }}>Назад</SBtn>
            <SBtn onClick={() => setStep(3)} style={{ flex: 2 }}>Далее · документы</SBtn>
          </div>
        </>
      )}

      {/* Шаг 3: Документы */}
      {step === 3 && (
        <>
          <BlockCard title="Документы и путевые листы">
            {block2.map((it, i) => (
              <CheckRow key={it.label} item={it}
                onYes={() => toggleStatus(block2, setBlock2, i, "yes")}
                onNo={() => toggleStatus(block2, setBlock2, i, "no")}
                onNote={note => {
                  if (it.label === "Путевые листы") {
                    const n = parseInt(note) || 0;
                    setBlock2count(prev => { const a = [...prev]; a[i] = n; return a; });
                  } else {
                    setNote(setBlock2, i, note);
                  }
                }}
                onPhoto={file => uploadItemPhoto(setBlock2, i, file)}
                invalid={attempted && it.status === ""}
              />
            ))}
          </BlockCard>
          <div style={{ display: "flex", gap: 10 }}>
            <SBtn variant="secondary" onClick={() => setStep(2)} style={{ flex: 1 }}>Назад</SBtn>
            <SBtn onClick={() => setStep(4)} style={{ flex: 2 }}>Далее · комплектация</SBtn>
          </div>
        </>
      )}

      {/* Шаг 4: Комплектация */}
      {step === 4 && (
        <>
          <BlockCard title="Комплектация">
            {equipment.map((it, i) => (
              <CheckRow key={it.label} item={it}
                onYes={() => toggleStatus(equipment, setEquipment, i, "yes")}
                onNo={() => toggleStatus(equipment, setEquipment, i, "no")}
                onNote={note => setNote(setEquipment, i, note)}
                onPhoto={file => uploadItemPhoto(setEquipment, i, file)}
                invalid={attempted && it.status === ""}
              />
            ))}
          </BlockCard>
          <div style={{ display: "flex", gap: 10 }}>
            <SBtn variant="secondary" onClick={() => setStep(3)} style={{ flex: 1 }}>Назад</SBtn>
            <SBtn onClick={() => setStep(5)} style={{ flex: 2 }}>Далее · чистота</SBtn>
          </div>
        </>
      )}

      {/* Шаг 5: Чистота + Такелаж */}
      {step === 5 && (
        <>
          <BlockCard title="Чистота">
            {cleanItems.map((it, i) => (
              <div key={it.label} style={{ borderBottom: "1px solid var(--line-row)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px" }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{it.label}</span>
                  {(["clean","medium","dirty"] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => setCleanItems(prev => prev.map((c, ci) => ci === i ? { ...c, status: c.status === v ? "" : v } : c))}
                      style={{
                        padding: "5px 10px", borderRadius: "var(--r-sm)", border: "none",
                        fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-ui)",
                        background: it.status === v
                          ? (v === "clean" ? "var(--success-bg)" : v === "medium" ? "var(--warn-bg)" : "var(--danger-bg)")
                          : "var(--surface-2)",
                        color: it.status === v
                          ? (v === "clean" ? "var(--success)" : v === "medium" ? "var(--warn)" : "var(--danger)")
                          : "var(--text-2)",
                      }}
                    >
                      {v === "clean" ? "Чисто" : v === "medium" ? "Средне" : "Грязно"}
                    </button>
                  ))}
                  <input ref={el => { cleanPhotoRefs.current[i] = el; }}
                    type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadCleanPhoto(i, f); e.target.value = ""; }}
                  />
                  <button
                    onClick={() => cleanPhotoRefs.current[i]?.click()}
                    style={{
                      width: 34, height: 34, borderRadius: "var(--r-sm)",
                      background: "var(--surface-2)", border: "none",
                      display: "grid", placeItems: "center", cursor: "pointer", color: "var(--text-2)",
                    }}
                  >
                    {it.uploading ? <IconClock size={15} /> : <IconCamera size={15} />}
                  </button>
                </div>
                {it.photoPath && (
                  <div style={{ padding: "0 16px 12px" }}>
                    <img src={photoUrl(it.photoPath)} alt=""
                      style={{ width: 80, height: 60, borderRadius: 8, objectFit: "cover" }} />
                  </div>
                )}
              </div>
            ))}
          </BlockCard>

          <BlockCard title="Такелаж">
            {rigging.map((it, i) => (
              <div key={it.label} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
                borderBottom: "1px solid var(--line-row)",
              }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{it.label}</span>
                <input
                  type="number" inputMode="numeric"
                  style={{ width: 72, height: 36, ...inputStyle, fontSize: 13 }}
                  value={it.qty}
                  onChange={e => setRigging(prev => prev.map((r, ri) => ri === i ? { ...r, qty: e.target.value } : r))}
                  placeholder="0"
                />
                {(["yes","no"] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => setRigging(prev => prev.map((r, ri) => ri === i ? { ...r, status: r.status === v ? "" : v } : r))}
                    style={{
                      width: 52, height: 36, borderRadius: "var(--r-sm)", border: "none",
                      fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)",
                      background: it.status === v
                        ? (v === "yes" ? "var(--invert)" : "var(--danger-bg)")
                        : "var(--surface-2)",
                      color: it.status === v
                        ? (v === "yes" ? "var(--on-invert)" : "var(--danger)")
                        : "var(--text-2)",
                    }}
                  >
                    {v === "yes" ? "Да" : "Нет"}
                  </button>
                ))}
              </div>
            ))}
          </BlockCard>

          {submitError && (
            <div style={{
              padding: "10px 14px", borderRadius: "var(--r-md)", marginBottom: 12,
              background: "var(--danger-bg)", color: "var(--danger)", fontSize: 13,
            }}>
              {submitError}
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <SBtn variant="secondary" onClick={() => setStep(4)} style={{ flex: 1 }}>Назад</SBtn>
            <SBtn onClick={handleSubmit} disabled={submitting} style={{ flex: 2 }}>
              {submitting ? "Отправка…" : kind === "start" ? "Принять машину" : "Сдать машину"}
            </SBtn>
          </div>
          <div style={{ textAlign: "center", fontSize: 11, color: "var(--text-4)", marginTop: 10 }}>
            Черновик сохраняется автоматически
          </div>
        </>
      )}
    </div>
  );
}

// ── InstructionContent ─────────────────────────────────────────────────────────
function InstructionContent({ onClose }: { onClose: () => void }) {
  const sections = [
    { t: "Вход в систему", b: "Введите логин и пароль, выданные бригадиром или администратором. Если забыли пароль — обратитесь к бригадиру." },
    { t: "Главный экран", b: "Здесь отображаются ваш баланс, последние рейсы, активная машина и кнопки быстрых действий." },
    { t: "Приём и сдача авто", b: "Перед началом смены нажмите «Принять машину» и пройдите 5 шагов: пробег, состояние, документы, комплектация, чистота и такелаж. По окончании смены — «Сдать»." },
    { t: "Пробег", b: "Нажмите «Пробег +» и введите текущее показание одометра. Это нужно для расчёта выплат по тарифу за км." },
    { t: "Расходы и компенсации", b: "«Расход +» — запись расхода на баланс или заявка на компенсацию. Для компенсации прикрепите чек." },
    { t: "Ремонт", b: "Через «Ремонт» создайте заявку с описанием и фото. Бригадир увидит её и возьмёт в работу." },
    { t: "Рейсы", b: "В разделе «Рейсы» вы можете просмотреть свои поездки за выбранный период." },
    { t: "Баланс и выписка", b: "Нажмите на сумму баланса или ссылку «Выписка», чтобы увидеть все начисления, авансы и штрафы." },
    { t: "Профиль", b: "Данные профиля (ВУ, паспорт, СКЗИ) заполняет администратор. Вы можете сменить пароль." },
    { t: "FAQ", b: "По всем вопросам обращайтесь к бригадиру или через заявку на ремонт с описанием проблемы." },
  ];
  return (
    <div>
      <SheetHeader title="Инструкция" onClose={onClose} />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sections.map((s, i) => (
          <div key={i} style={{
            background: "var(--surface-2)", borderRadius: "var(--r-lg)", padding: "14px 16px",
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>
              {i + 1}. {s.t}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>{s.b}</div>
          </div>
        ))}
      </div>
      <SBtn onClick={onClose} style={{ marginTop: 20 }}>Понятно</SBtn>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Главный компонент
// ══════════════════════════════════════════════════════════════════════════════
export default function DriverDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSession>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modal, setModal] = useState<
    "mileage"|"expense"|"repair"|"handover"|"weekly"|"profile"|"changepass"|"truckinfo"|"instruction"|null
  >(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [truckInfo, setTruckInfo] = useState<TruckInfo | null>(null);
  const [, setTruckInfoLoading] = useState(false);

  const [cpOld, setCpOld] = useState("");
  const [cpNew, setCpNew] = useState("");
  const [cpNew2, setCpNew2] = useState("");
  const [cpSaving, setCpSaving] = useState(false);
  const [cpOk, setCpOk] = useState(false);
  const [cpError, setCpError] = useState<string | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [, setTxData] = useState<TxData | null>(null);
  const [fullLedger, setFullLedger] = useState<LedgerEntry[]>([]);

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
  const [eType, setEType] = useState<"balance"|"compensation">("balance");
  const [ePhotoUploading, setEPhotoUploading] = useState(false);
  const [ePhotoPaths, setEPhotoPaths] = useState<string[]>([]);
  const expensePhotoRef = useRef<HTMLInputElement>(null);
  const [expenseCategories, setExpenseCategories] = useState<string[]>(EXPENSE_CATEGORIES);

  const [myComps, setMyComps] = useState<MyComp[]>([]);
  const [hideClosedComps, setHideClosedComps] = useState(false);

  const [rText, setRText] = useState("");
  const [rSaving, setRSaving] = useState(false);
  const [rOk, setROk] = useState(false);
  const [rTruckId, setRTruckId] = useState<number | null>(null);
  const [rPhotoPaths, setRPhotoPaths] = useState<string[]>([]);
  const [rPhotoUploading, setRPhotoUploading] = useState(false);
  const [rPriority, setRPriority] = useState<"обычная"|"срочная">("обычная");
  const repairPhotoRef = useRef<HTMLInputElement>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [myRepairs, setMyRepairs] = useState<MyRepair[]>([]);
  const [foremanAlertCount, setForemanAlertCount] = useState(0);
  const [ledgerFilter, setLedgerFilter] = useState<"all"|"accrual"|"advance"|"compensation"|"fine">("all");

  // ── Загрузка ──
  async function loadData() {
    setLoading(true); setError(null);
    try {
      const [s, t, sess] = await Promise.all([
        api.get<Summary>("/api/driver-dashboard/summary"),
        api.get<Truck[]>("/api/trucks/"),
        api.get<ActiveSession>("/api/vehicle-inspections/active-session"),
      ]);
      setSummary(s); setTrucks(t); setActiveSession(sess);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally { setLoading(false); }
  }

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    api.get<MyRepair[]>("/api/repair-requests/journal/")
      .then(list => setMyRepairs(list.filter(r => r.status !== "закрыта")))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (user?.role !== "foreman") return;
    api.get<{ alert_count: number }>("/api/foreman-dashboard/summary")
      .then(d => setForemanAlertCount(d.alert_count))
      .catch(() => {});
  }, [user?.role]);
  useEffect(() => {
    if (!localStorage.getItem("driver_instruction_v1")) setModal("instruction");
  }, []);
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
    setFormError(null); setMOk(false); setEOk(false); setROk(false);
    if (m === "expense") { setEType("balance"); setEPhotoPaths([]); setEDate(isoDate(new Date())); setEAmount(""); setEDesc(""); }
    if (m === "repair") { setRTruckId(activeSession?.truck_id ?? null); setRPhotoPaths([]); setRText(""); setRPriority("обычная"); }
    setModal(m);
  }

  async function handleChangePassword() {
    if (!cpOld) { setCpError("Введите текущий пароль"); return; }
    if (cpNew.length < 6) { setCpError("Новый пароль — минимум 6 символов"); return; }
    if (cpNew !== cpNew2) { setCpError("Пароли не совпадают"); return; }
    setCpSaving(true); setCpError(null);
    try {
      await api.post("/api/auth/change-password", { old_password: cpOld, new_password: cpNew });
      setCpOk(true); setCpOld(""); setCpNew(""); setCpNew2("");
    } catch (err) {
      setCpError(err instanceof ApiError ? err.message : "Ошибка");
    } finally { setCpSaving(false); }
  }

  async function openProfile() {
    setModal("profile");
    if (profile) return;
    setProfileLoading(true);
    try { setProfile(await api.get<ProfileData>("/api/driver-dashboard/profile")); }
    catch { /* нет данных */ } finally { setProfileLoading(false); }
  }

  async function openWeekly() {
    setModal("weekly"); setWeeklyLoading(true);
    const [txs, ledger] = await Promise.all([
      api.get<TxData>("/api/driver-transactions/").catch(() => ({ balance_adjustment: 0, transactions: [] } as TxData)),
      api.get<LedgerEntry[]>("/api/driver-transactions/full-ledger").catch(() => [] as LedgerEntry[]),
    ]);
    setTxData(txs); setFullLedger(ledger); setWeeklyLoading(false);
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
    } catch (err) { setFormError(err instanceof ApiError ? err.message : "Ошибка"); }
    finally { setMSaving(false); }
  }

  async function uploadExpensePhoto(file: File) {
    setEPhotoUploading(true);
    try {
      const res = await api.upload<{ filename: string }>("/api/vehicle-inspections/photo", file);
      setEPhotoPaths(prev => [...prev, res.filename]);
    } catch { /* необязательно */ } finally { setEPhotoUploading(false); }
  }

  async function handleExpenseSubmit() {
    if (!eAmount || Number(eAmount) <= 0) { setFormError("Введите сумму"); return; }
    setESaving(true); setFormError(null);
    try {
      if (eType === "balance") {
        await api.post("/api/driver-dashboard/expense", {
          expense_date: eDate, amount: Number(eAmount), category: eCategory, description: eDesc,
        });
      } else {
        await api.post("/api/compensation-requests/", {
          expense_date: eDate, amount: Number(eAmount), category: eCategory, description: eDesc,
          photo_paths: JSON.stringify(ePhotoPaths), truck_id: activeSession?.truck_id ?? null,
        });
      }
      setEOk(true); setEAmount(""); setEDesc(""); setEPhotoPaths([]);
      if (eType === "compensation") {
        api.get<MyComp[]>("/api/compensation-requests/journal/").then(list => setMyComps(list)).catch(() => {});
      }
    } catch (err) { setFormError(err instanceof ApiError ? err.message : "Ошибка"); }
    finally { setESaving(false); }
  }

  async function uploadRepairPhoto(file: File) {
    setRPhotoUploading(true);
    try {
      const res = await api.upload<{ filename: string }>("/api/vehicle-inspections/photo", file);
      setRPhotoPaths(prev => [...prev, res.filename]);
    } catch { /* необязательно */ } finally { setRPhotoUploading(false); }
  }

  async function handleRepairSubmit() {
    if (!rText.trim()) { setFormError("Опишите проблему"); return; }
    setRSaving(true); setFormError(null);
    try {
      await api.post("/api/repair-requests/", {
        driver_id: user?.driver_id ?? null, truck_id: rTruckId,
        text: rText.trim(), photo_paths: JSON.stringify(rPhotoPaths), priority: rPriority,
      });
      setROk(true); setRText(""); setRPhotoPaths([]); setRPriority("обычная");
      api.get<MyRepair[]>("/api/repair-requests/journal/")
        .then(list => setMyRepairs(list.filter(r => r.status !== "закрыта")))
        .catch(() => {});
    } catch (err) { setFormError(err instanceof ApiError ? err.message : "Ошибка"); }
    finally { setRSaving(false); }
  }

  const initials = (() => {
    const name = (user?.full_name || user?.username || "").trim();
    if (!name) return "В";
    const parts = name.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  })();
  const lastWeekEnd = summary?.last_week_start
    ? (() => { const d = new Date(summary.last_week_start!); d.setDate(d.getDate() + 6); return d.toISOString().slice(0, 10); })()
    : null;
  const balanceNeg = (summary?.balance ?? 0) < 0;

  async function openTruckInfo() {
    if (!activeSession) return;
    if (truckInfo) { setModal("truckinfo"); return; }
    setTruckInfoLoading(true);
    try {
      const info = await api.get<TruckInfo>(`/api/driver-dashboard/truck/${activeSession.truck_id}`);
      setTruckInfo(info); setModal("truckinfo");
    } catch { /* игнорируем */ } finally { setTruckInfoLoading(false); }
  }

  // ── Рендер ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100dvh",
      background: "var(--bg)",
      color: "var(--ink)",
      fontFamily: "var(--font-ui)",
      maxWidth: 480,
      margin: "0 auto",
    }}>

      {/* ── Шапка ── */}
      <div style={{
        padding: "max(env(safe-area-inset-top,0px),16px) 16px 16px",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        {/* Аватар — лайм 38×38, 2 инициала */}
        <button
          onClick={openProfile}
          style={{
            width: 38, height: 38, borderRadius: "50%",
            background: "var(--accent)", color: "var(--on-accent)",
            display: "grid", placeItems: "center",
            fontWeight: 600, fontSize: 13, border: "none",
            cursor: "pointer", flexShrink: 0,
            fontFamily: "var(--font-ui)",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {initials}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: -0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink)" }}>
            {user?.full_name || user?.username}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)", marginTop: 1 }}>
            водитель
          </div>
        </div>

        {user?.role === "foreman" && (
          <button
            onClick={() => navigate("/foreman")}
            title="Кабинет бригадира"
            style={{
              position: "relative",
              width: 36, height: 36, borderRadius: "50%",
              background: "var(--surface)", border: "none",
              color: "var(--text-2)", fontSize: 11, fontWeight: 700,
              cursor: "pointer", flexShrink: 0,
              display: "grid", placeItems: "center",
              fontFamily: "var(--font-ui)",
            }}
          >
            БР
            {foremanAlertCount > 0 && (
              <span style={{
                position: "absolute", top: -3, right: -3,
                background: "var(--danger-dot)", color: "#fff",
                borderRadius: "50%", fontSize: 9, fontWeight: 700,
                width: 14, height: 14,
                display: "grid", placeItems: "center",
                border: "2px solid var(--surface)",
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
            background: "var(--surface)", border: "none",
            color: "var(--text-2)", fontSize: 15, fontWeight: 700,
            cursor: "pointer", flexShrink: 0,
            display: "grid", placeItems: "center",
          }}
        >
          ℹ
        </button>

        <button
          onClick={() => { logout(); navigate("/login", { replace: true }); }}
          title="Выйти"
          style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "var(--surface)", border: "none",
            color: "var(--text-2)", cursor: "pointer", flexShrink: 0,
            display: "grid", placeItems: "center",
          }}
        >
          <IconLogout size={16} />
        </button>

      </div>

      {/* ── Тело ── */}
      <div style={{ padding: "16px 16px 48px" }}>

        {loading && (
          <div style={{
            display: "flex", flexDirection: "column", gap: 12, paddingTop: 8,
          }}>
            {[80, 108, 88].map((h, i) => (
              <div key={i} className="ds-skeleton" style={{ height: h, borderRadius: "var(--r-xl)" }} />
            ))}
          </div>
        )}

        {!loading && error && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            gap: 12, padding: "60px 0", color: "var(--text-2)", textAlign: "center",
          }}>
            <IconWarning size={36} style={{ color: "var(--danger)", opacity: 0.6 }} />
            <div style={{ fontSize: 14 }}>{error}</div>
            <button
              onClick={loadData}
              style={{
                padding: "9px 20px", borderRadius: "var(--r-md)",
                background: "var(--invert)", color: "var(--on-invert)",
                border: "none", cursor: "pointer", fontFamily: "var(--font-ui)",
                fontSize: 14, fontWeight: 600,
              }}
            >
              Повторить
            </button>
          </div>
        )}

        {/* Приём машины (если нет активной сессии) — сразу под шапкой */}
        {!loading && !error && !activeSession && (
          <button
            onClick={() => openModal("handover")}
            style={{
              width: "100%", height: 52, borderRadius: "var(--r-xl)",
              background: "var(--invert)", color: "var(--on-invert)",
              border: "none", cursor: "pointer",
              fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 700,
              marginBottom: 12, display: "flex", alignItems: "center",
              justifyContent: "center", gap: 10,
            }}
          >
            <IconTruck size={18} /> Принять машину
          </button>
        )}

        {!loading && !error && (<>

          {/* ── Баннер активной машины — чёрный ── */}
          {activeSession && (
            <div style={{
              background: "var(--invert)",
              borderRadius: "var(--r-xl)",
              padding: "14px 16px",
              marginBottom: 12,
              display: "flex", alignItems: "center", gap: 12,
            }}>
              {/* Иконка-квадрат 34×34 */}
              <div
                onClick={openTruckInfo}
                style={{
                  width: 34, height: 34, borderRadius: "var(--r-md)",
                  background: "rgba(255,255,255,.1)",
                  display: "grid", placeItems: "center",
                  flexShrink: 0, cursor: "pointer",
                  color: "var(--accent)",
                }}
              >
                <IconTruck size={18} />
              </div>

              <div
                onClick={openTruckInfo}
                style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
              >
                <div style={{
                  fontSize: 14, fontWeight: 500, color: "var(--on-invert)",
                  fontFamily: "var(--font-mono)", letterSpacing: 0.5,
                }}>
                  {activeSession.truck_plate || activeSession.truck_label}
                </div>
                <div style={{
                  fontSize: 11, fontFamily: "var(--font-mono)",
                  color: "var(--on-invert-dim)", marginTop: 2,
                }}>
                  принята {fmtShort(activeSession.started_at)} в{" "}
                  {new Date(activeSession.started_at).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})}
                </div>
              </div>
              <button
                onClick={() => openModal("handover")}
                style={{
                  background: "var(--accent)", color: "var(--on-accent)",
                  border: "none", borderRadius: "var(--r-md)",
                  padding: "10px 14px", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", fontFamily: "var(--font-ui)",
                  flexShrink: 0, whiteSpace: "nowrap",
                }}
              >
                Сдать
              </button>
            </div>
          )}

          {/* ── Карточка баланса ── */}
          <div style={{
            background: "var(--surface)",
            borderRadius: "var(--r-xl)",
            border: "1px solid var(--line)",
            padding: 16,
            marginBottom: 12,
          }}>
            {/* Шапка карточки: метка + ссылка Выписка на одной строке */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{
                fontSize: 10, fontWeight: 500, letterSpacing: "0.07em",
                textTransform: "uppercase", fontFamily: "var(--font-mono)",
                color: "var(--text-4)",
              }}>
                Баланс к выплате
              </div>
              <button
                onClick={openWeekly}
                style={{
                  background: "none", border: "none", padding: 0,
                  color: "var(--accent-ink)", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", fontFamily: "var(--font-ui)",
                }}
              >
                Выписка
              </button>
            </div>

            {/* Большое число */}
            <div style={{
              fontSize: 44, fontWeight: 300, letterSpacing: -1.5, lineHeight: 1.05,
              fontVariantNumeric: "tabular-nums",
              color: balanceNeg ? "var(--danger)" : "var(--ink)",
              marginBottom: 4,
            }}>
              {money(summary?.balance ?? 0)}
            </div>

            {summary?.as_of && (
              <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 10, fontFamily: "var(--font-mono)" }}>
                по данным на {fmtDate(summary.as_of)}
              </div>
            )}

            {/* Полоса: лайм = остаток, чёрный = аванс */}
            {(() => {
              const earned = (summary?.last_week_payout ?? 0) > 0
                ? summary!.last_week_payout
                : (summary?.balance ?? 0);
              if (earned <= 0) return null;
              const avans = Math.max(0, earned - (summary?.balance ?? 0));
              const limePct  = Math.min(100, Math.max(0, (1 - avans / earned) * 100));
              const blackPct = Math.min(100 - limePct, (avans / earned) * 100);
              return (
                <div>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--bar-done)", overflow: "hidden", display: "flex" }}>
                    <div style={{ height: "100%", background: "var(--accent)", width: `${limePct}%`, borderRadius: "4px 0 0 4px" }} />
                    {blackPct > 0 && (
                      <div style={{ height: "100%", background: "var(--invert)", width: `${blackPct}%` }} />
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                      заработано {Number(earned).toLocaleString("ru-RU")} ₽
                    </span>
                    {avans > 0 && (
                      <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                        аванс {Number(avans).toLocaleString("ru-RU")} ₽
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* ── Плитки рейсов ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <button
              onClick={() => {
                const from = summary?.last_week_start ?? null;
                const to = lastWeekEnd;
                navigate(`/driver/trips${from && to ? `?from=${from}&to=${to}&filter=completed` : "?filter=completed"}`);
              }}
              style={{
                background: "var(--surface)", borderRadius: "var(--r-lg)",
                border: "1px solid var(--line)",
                padding: 14, textAlign: "left",
                display: "flex", flexDirection: "column", gap: 6,
                cursor: "pointer", fontFamily: "var(--font-ui)",
              }}
            >
              <div style={{
                fontSize: 9.5, fontWeight: 500, textTransform: "uppercase",
                letterSpacing: "0.07em", fontFamily: "var(--font-mono)", color: "var(--text-4)",
              }}>
                Рейсы за неделю
              </div>
              <div style={{
                fontSize: 30, fontWeight: 300, lineHeight: 1,
                color: "var(--ink)", fontVariantNumeric: "tabular-nums",
              }}>
                {summary?.last_week_trips ?? 0}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
                {weekLabel(summary?.last_week_start ?? null, lastWeekEnd)}
              </div>
            </button>

            <button
              onClick={() => {
                const from = summary?.last_week_start ?? null;
                const to = lastWeekEnd;
                navigate(`/driver/trips${from && to ? `?from=${from}&to=${to}&filter=cancelled` : "?filter=cancelled"}`);
              }}
              style={{
                background: "var(--surface)",
                borderRadius: "var(--r-lg)",
                border: "1px solid var(--line)",
                padding: 14, textAlign: "left",
                display: "flex", flexDirection: "column", gap: 6,
                cursor: "pointer", fontFamily: "var(--font-ui)",
              }}
            >
              <div style={{
                fontSize: 9.5, fontWeight: 500, textTransform: "uppercase",
                letterSpacing: "0.07em", fontFamily: "var(--font-mono)",
                color: "var(--text-4)",
              }}>
                Отменено
              </div>
              <div style={{
                fontSize: 30, fontWeight: 300, lineHeight: 1,
                color: "var(--ink)",
                fontVariantNumeric: "tabular-nums",
              }}>
                {summary?.last_week_cancelled ?? 0}
              </div>
              {(summary?.last_week_cancelled_fines ?? 0) > 0 && (
                <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                  −{money(summary!.last_week_cancelled_fines)}
                </div>
              )}
            </button>
          </div>

          {/* ── Быстрые действия ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
            {[
              { label: "Пробег", icon: <IconGauge size={18} />, fn: () => openModal("mileage") },
              { label: "Расход", icon: <IconRuble size={18} />, fn: () => openModal("expense") },
              { label: "Ремонт", icon: <IconWrench size={18} />, fn: () => openModal("repair") },
            ].map(({ label, icon, fn }) => (
              <button
                key={label}
                onClick={fn}
                style={{
                  borderRadius: "var(--r-lg)", padding: "13px 12px",
                  display: "flex", flexDirection: "column", gap: 12,
                  background: "var(--surface)", border: "1px solid var(--line)",
                  cursor: "pointer", fontFamily: "var(--font-ui)", textAlign: "left",
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: 9,
                  background: "var(--surface-2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--ink)", flexShrink: 0,
                }}>
                  {icon}
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{label}</span>
              </button>
            ))}
          </div>


          {/* ── Мои заявки (компенсации + ремонт — единый список как в макете) ── */}
          {(myComps.length > 0 || myRepairs.length > 0) && (() => {
            const chipStyle = (status: string): React.CSSProperties => {
              const map: Record<string, [string, string]> = {
                "на рассмотрении": ["var(--warn)", "var(--warn-bg)"],
                "принято":         ["var(--success)", "var(--success-bg)"],
                "отказано":        ["var(--danger)", "var(--danger-bg)"],
                "в работе":        ["var(--warn)", "var(--warn-bg)"],
              };
              const [color, bg] = map[status] ?? ["var(--text-3)", "var(--surface-2)"];
              return {
                fontSize: 11, fontWeight: 600, padding: "3px 9px",
                borderRadius: "var(--r-xs)", color, background: bg,
                whiteSpace: "nowrap" as const,
              };
            };

            type UnifiedItem =
              | { kind: "comp"; id: number; title: string; sub: string; date: string; chipStatus: string; chipLabel: string }
              | { kind: "repair"; id: number; title: string; sub: string; date: string; chipStatus: string; chipLabel: string; urgent: boolean };

            const compItems: UnifiedItem[] = myComps.map(c => ({
              kind: "comp" as const, id: c.id,
              title: `Компенсация: ${c.category}${c.amount ? ` ${Number(c.amount).toLocaleString("ru-RU")} ₽` : ""}`,
              sub: c.description || "",
              date: c.created_at,
              chipStatus: c.status,
              chipLabel: c.status === "на рассмотрении" ? "Ждёт"
                : c.status === "принято" ? "Принято" : "Отказано",
            }));

            const repairItems: UnifiedItem[] = myRepairs.map(r => ({
              kind: "repair" as const, id: r.id,
              title: `Ремонт: ${r.text}`,
              sub: r.truck_label || "",
              date: r.created_at,
              urgent: r.priority === "срочная",
              chipStatus: r.status,
              chipLabel: r.status === "в работе" ? "В работе" : "Создана",
            }));

            const DONE = ["принято", "отказано", "закрыта"];
            const filtered = [...compItems, ...repairItems]
              .filter(item => !hideClosedComps || !DONE.includes(item.chipStatus))
              .sort((a, b) => b.date.localeCompare(a.date));
            const allItems = filtered.slice(0, 8);
            const hiddenCount = [...compItems, ...repairItems]
              .filter(item => DONE.includes(item.chipStatus)).length;

            const activeCount = myComps.filter(c => c.status === "на рассмотрении").length
              + myRepairs.filter(r => r.status === "в работе").length;

            return (
              <div style={{
                background: "var(--surface)", borderRadius: "var(--r-xl)",
                border: "1px solid var(--line)", padding: "14px 16px 4px", marginBottom: 12,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                    Мои заявки
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {activeCount > 0 && (
                      <span style={{
                        background: "var(--warn-bg)", color: "var(--warn)",
                        borderRadius: "var(--r-xs)", fontSize: 11, fontWeight: 600,
                        padding: "3px 8px",
                      }}>
                        {activeCount} в работе
                      </span>
                    )}
                    {hiddenCount > 0 && (
                      <button
                        onClick={() => setHideClosedComps(v => !v)}
                        style={{
                          background: "none", border: "none", padding: 0,
                          fontSize: 11, fontWeight: 600, cursor: "pointer",
                          color: "var(--text-3)", fontFamily: "var(--font-ui)",
                        }}
                      >
                        {hideClosedComps ? `показать завершённые (${hiddenCount})` : "скрыть завершённые"}
                      </button>
                    )}
                  </div>
                </div>
                {allItems.map(item => (
                  <div key={`${item.kind}-${item.id}`} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "12px 0", borderTop: "1px solid var(--line-row)",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.title}
                        {item.kind === "repair" && item.urgent && (
                          <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--danger)", verticalAlign: "middle" }}>
                            СРОЧНО
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2, fontFamily: "var(--font-mono)" }}>
                        {new Date(item.date).toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit"})}
                        {item.sub ? ` · ${item.sub}` : ""}
                      </div>
                    </div>
                    <span style={chipStyle(item.chipStatus)}>{item.chipLabel}</span>
                  </div>
                ))}
                {(myComps.length + myRepairs.length) > 6 && (
                  <div style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center", paddingTop: 8 }}>
                    +{myComps.length + myRepairs.length - 6} ещё
                  </div>
                )}
              </div>
            );
          })()}

        </>)}
      </div>

      {/* ── Sheets ── */}
      {modal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }}
          style={{
            position: "fixed", inset: 0,
            background: "var(--overlay)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            zIndex: 100,
          }}
        >
          <div
            key={modal}
            className="ds-anim-sheet-up"
            style={{
              background: "var(--surface)",
              borderRadius: "20px 20px 0 0",
              padding: "20px 18px 28px",
              paddingBottom: "max(env(safe-area-inset-bottom,0px),28px)",
              width: "100%", maxWidth: 480,
              maxHeight: "90vh", overflowY: "auto",
            }}
          >

            {/* Инструкция */}
            {modal === "instruction" && (
              <InstructionContent onClose={() => {
                localStorage.setItem("driver_instruction_v1", "1");
                setModal(null);
              }} />
            )}

            {/* Выписка по балансу */}
            {modal === "weekly" && (() => {
              const TX_LABELS: Record<string, string> = {
                pnl_accrual: "Начислено", pnl_payment: "Выплачено",
                compensation: "Компенсация", advance: "Аванс",
                fine_pdd: "Штраф ПДД", fine_company: "Штраф от компании", payout: "Выплата",
              };
              const nacisleno  = fullLedger.filter(e => e.entry_type === "pnl_accrual" && e.amount > 0).reduce((s, e) => s + e.amount, 0);
              const payoutSum  = fullLedger.filter(e => ["pnl_payment","advance"].includes(e.entry_type) && e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);
              const fineSum    = fullLedger.filter(e => e.entry_type.includes("fine") && e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);
              const FILTER_MAP: Record<typeof ledgerFilter, string[]> = {
                all:          [],
                accrual:      ["pnl_accrual","pnl_payment"],
                advance:      ["advance"],
                compensation: ["compensation"],
                fine:         ["fine_pdd","fine_company"],
              };
              const visibleEntries = ledgerFilter === "all"
                ? fullLedger
                : fullLedger.filter(e => FILTER_MAP[ledgerFilter].includes(e.entry_type));
              const TABS: { key: typeof ledgerFilter; label: string }[] = [
                { key: "all",          label: "Всё" },
                { key: "accrual",      label: "Начисления" },
                { key: "advance",      label: "Авансы" },
                { key: "compensation", label: "Компенсации" },
                { key: "fine",         label: "Штрафы" },
              ];
              return (
                <div>
                  <SheetHeader title="Выписка" onClose={() => { setModal(null); setLedgerFilter("all"); }} />

                  {/* Герой-блок лайм */}
                  <div style={{
                    background: "var(--accent)", borderRadius: "var(--r-xl)",
                    padding: "18px 20px 16px", marginBottom: 12,
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "var(--font-mono)", color: "var(--on-accent)", opacity: 0.6, marginBottom: 4 }}>
                      Итого к выплате
                    </div>
                    <div style={{ fontSize: 43, fontWeight: 300, letterSpacing: -1.5, lineHeight: 1, color: "var(--on-accent)", fontVariantNumeric: "tabular-nums", marginBottom: 14 }}>
                      {money(summary?.balance ?? 0)}
                    </div>
                    {!weeklyLoading && (
                      <div style={{ display: "flex", gap: 0, borderTop: "1px solid rgba(0,0,0,.12)", paddingTop: 12 }}>
                        {[
                          { label: "Начислено", val: nacisleno },
                          { label: "Выплачено", val: payoutSum },
                          { label: "Удержано",  val: fineSum },
                        ].map((it, i) => (
                          <div key={it.label} style={{
                            flex: 1, textAlign: i === 0 ? "left" : i === 2 ? "right" : "center",
                          }}>
                            <div style={{ fontSize: 9, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "var(--font-mono)", color: "var(--on-accent)", opacity: 0.55, marginBottom: 3 }}>
                              {it.label}
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--on-accent)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                              {it.val === 0 ? "0" : Number(it.val).toLocaleString("ru-RU")}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Вкладки-фильтры */}
                  <div style={{
                    display: "flex", gap: 6, overflowX: "auto", marginBottom: 12,
                    scrollbarWidth: "none", WebkitOverflowScrolling: "touch",
                    paddingBottom: 2,
                  }}>
                    {TABS.map(tab => (
                      <button
                        key={tab.key}
                        onClick={() => setLedgerFilter(tab.key)}
                        style={{
                          flexShrink: 0, padding: "7px 13px", borderRadius: "var(--r-md)",
                          border: "none", cursor: "pointer", fontFamily: "var(--font-ui)",
                          fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
                          background: ledgerFilter === tab.key ? "var(--invert)" : "var(--surface-2)",
                          color: ledgerFilter === tab.key ? "var(--on-invert)" : "var(--text-2)",
                        }}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Блок операций на фоне страницы */}
                  <div style={{
                    margin: "0 -18px",
                    padding: "12px 18px 0",
                    background: "var(--bg)",
                    minHeight: 80,
                  }}>
                    {weeklyLoading ? (
                      <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-3)" }}>Загрузка…</div>
                    ) : visibleEntries.length === 0 ? (
                      <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-3)" }}>Операций нет</div>
                    ) : (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>Операции</span>
                          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-3)" }}>
                            {visibleEntries.length} из {fullLedger.length}
                          </span>
                        </div>
                        <div style={{
                          background: "var(--surface)", borderRadius: "var(--r-xl)",
                          border: "1px solid var(--line)", overflow: "hidden",
                        }}>
                          {visibleEntries.map((entry, i) => {
                            const isCredit = entry.amount > 0;
                            const isFine = entry.entry_type.includes("fine");
                            const isAdvance = entry.entry_type === "advance";
                            const dotColor = isFine ? "var(--danger-dot)" : isAdvance ? "var(--invert)" : isCredit ? "var(--accent)" : "var(--text-4)";
                            const title = entry.description || TX_LABELS[entry.entry_type] || entry.entry_type;
                            const subtitle = entry.description ? (TX_LABELS[entry.entry_type] ? `${TX_LABELS[entry.entry_type]} · ${fmtDate(entry.date)}` : fmtDate(entry.date)) : fmtDate(entry.date);
                            return (
                              <div key={i} style={{
                                display: "flex", alignItems: "flex-start", gap: 12,
                                padding: "12px 14px",
                                borderBottom: i < visibleEntries.length - 1 ? "1px solid var(--line-row)" : "none",
                              }}>
                                <div style={{
                                  width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 5,
                                  background: dotColor,
                                }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {title}
                                  </div>
                                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2, fontFamily: "var(--font-mono)" }}>
                                    {subtitle}
                                  </div>
                                </div>
                                <span style={{
                                  fontWeight: 600, fontSize: 14, whiteSpace: "nowrap",
                                  fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
                                  color: isFine ? "var(--danger)" : isCredit ? "var(--success)" : "var(--ink)",
                                }}>
                                  {isCredit ? "+" : ""}{money(entry.amount)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ background: "var(--bg)", margin: "0 -18px", padding: "12px 18px 0" }}>
                    <SBtn onClick={() => { setModal(null); setLedgerFilter("all"); }}>Закрыть</SBtn>
                  </div>
                </div>
              );
            })()}

            {/* Пробег */}
            {modal === "mileage" && (
              <div>
                <SheetHeader title="Показание пробега" onClose={() => setModal(null)} />
                {mOk ? (
                  <SuccessScreen text="Сохранено!" onClose={() => setModal(null)} />
                ) : (
                  <>
                    {formError && (
                      <div style={{ background: "var(--danger-bg)", color: "var(--danger)", borderRadius: "var(--r-md)", padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
                        {formError}
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                      <select style={{ ...inputStyle, cursor: "pointer" }}
                        value={mTruckId} onChange={e => setMTruckId(e.target.value)}>
                        <option value="">— Выберите машину —</option>
                        {trucks.map(t => <option key={t.id} value={t.id}>{t.plate || t.label}</option>)}
                      </select>
                      <input type="number" inputMode="numeric" style={inputStyle}
                        placeholder="Одометр, км" value={mOdo} onChange={e => setMOdo(e.target.value)} />
                      <input style={inputStyle} placeholder="Примечание" value={mNote} onChange={e => setMNote(e.target.value)} />
                      <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer" }}>
                        <input type="checkbox" checked={mService} onChange={e => setMService(e.target.checked)} />
                        Сервисный пробег (ТО)
                      </label>
                    </div>
                    <SBtn onClick={handleMileageSubmit} disabled={mSaving}>
                      {mSaving ? "Сохранение…" : "Сохранить"}
                    </SBtn>
                  </>
                )}
              </div>
            )}

            {/* Расход */}
            {modal === "expense" && (
              <div>
                <SheetHeader title="Расход" onClose={() => setModal(null)} />
                {eOk ? (
                  <SuccessScreen text="Записано!" onClose={() => setModal(null)} />
                ) : (
                  <>
                    {/* Тип */}
                    <div className="seg" style={{ marginBottom: 14, width: "100%" }}>
                      {(["balance","compensation"] as const).map(t => (
                        <button key={t} className={`seg-item${eType === t ? " active" : ""}`}
                          style={{ flex: 1 }} onClick={() => setEType(t)}>
                          {t === "balance" ? "На баланс" : "Компенсация"}
                        </button>
                      ))}
                    </div>
                    {formError && (
                      <div style={{ background: "var(--danger-bg)", color: "var(--danger)", borderRadius: "var(--r-md)", padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
                        {formError}
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                      <input type="date" style={inputStyle} value={eDate} onChange={e => setEDate(e.target.value)} />
                      <input type="number" inputMode="numeric" style={inputStyle}
                        placeholder="Сумма, ₽" value={eAmount} onChange={e => setEAmount(e.target.value)} />
                      <select style={{ ...inputStyle, cursor: "pointer" }}
                        value={eCategory} onChange={e => setECategory(e.target.value)}>
                        {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input style={inputStyle} placeholder="Описание" value={eDesc} onChange={e => setEDesc(e.target.value)} />
                      {eType === "compensation" && (
                        <>
                          <input ref={expensePhotoRef} type="file" accept="image/*" style={{ display: "none" }}
                            onChange={async e => { const f = e.target.files?.[0]; if (f) { const c = await compressPhoto(f); uploadExpensePhoto(c); } e.target.value = ""; }}
                          />
                          <button
                            onClick={() => expensePhotoRef.current?.click()}
                            style={{ ...inputStyle, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", height: 44 }}
                          >
                            {ePhotoUploading ? <IconClock size={16} /> : <IconCamera size={16} />}
                            <span style={{ fontSize: 13, color: "var(--text-2)" }}>
                              {ePhotoPaths.length > 0 ? `${ePhotoPaths.length} фото` : "Прикрепить чек"}
                            </span>
                          </button>
                          {ePhotoPaths.length > 0 && (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {ePhotoPaths.map((p, i) => (
                                <img key={i} src={photoUrl(p)} alt="" style={{ width: 60, height: 60, borderRadius: 8, objectFit: "cover" }} />
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <SBtn onClick={handleExpenseSubmit} disabled={eSaving}>
                      {eSaving ? "Отправка…" : eType === "compensation" ? "Отправить заявку" : "Сохранить"}
                    </SBtn>
                  </>
                )}
              </div>
            )}

            {/* Ремонт */}
            {modal === "repair" && (
              <div>
                <SheetHeader title="Заявка на ремонт" onClose={() => setModal(null)} />
                {rOk ? (
                  <SuccessScreen text="Заявка отправлена!" onClose={() => setModal(null)} />
                ) : (
                  <>
                    {formError && (
                      <div style={{ background: "var(--danger-bg)", color: "var(--danger)", borderRadius: "var(--r-md)", padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
                        {formError}
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                      <select style={{ ...inputStyle, cursor: "pointer" }}
                        value={rTruckId ?? ""} onChange={e => setRTruckId(e.target.value ? Number(e.target.value) : null)}>
                        <option value="">— Машина (если знаете) —</option>
                        {trucks.map(t => <option key={t.id} value={t.id}>{t.plate || t.label}</option>)}
                      </select>
                      <div className="seg" style={{ width: "100%" }}>
                        {(["обычная","срочная"] as const).map(p => (
                          <button key={p} className={`seg-item${rPriority === p ? " active" : ""}`}
                            style={{ flex: 1 }} onClick={() => setRPriority(p)}>
                            {p === "обычная" ? "Обычная" : "Срочная"}
                          </button>
                        ))}
                      </div>
                      <textarea
                        style={{ ...inputStyle, height: 96, resize: "none", paddingTop: 12, paddingBottom: 12 }}
                        placeholder="Опишите проблему…"
                        value={rText}
                        onChange={e => setRText(e.target.value)}
                      />
                      <input ref={repairPhotoRef} type="file" accept="image/*" style={{ display: "none" }}
                        onChange={async e => { const f = e.target.files?.[0]; if (f) { const c = await compressPhoto(f); uploadRepairPhoto(c); } e.target.value = ""; }}
                      />
                      <button
                        onClick={() => repairPhotoRef.current?.click()}
                        style={{ ...inputStyle, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", height: 44 }}
                      >
                        {rPhotoUploading ? <IconClock size={16} /> : <IconCamera size={16} />}
                        <span style={{ fontSize: 13, color: "var(--text-2)" }}>
                          {rPhotoPaths.length > 0 ? `${rPhotoPaths.length} фото` : "Прикрепить фото"}
                        </span>
                      </button>
                      {rPhotoPaths.length > 0 && (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {rPhotoPaths.map((p, i) => (
                            <img key={i} src={photoUrl(p)} alt="" style={{ width: 60, height: 60, borderRadius: 8, objectFit: "cover" }} />
                          ))}
                        </div>
                      )}
                    </div>
                    <SBtn onClick={handleRepairSubmit} disabled={rSaving}>
                      {rSaving ? "Отправка…" : "Отправить"}
                    </SBtn>
                  </>
                )}
              </div>
            )}

            {/* Приёмка/Сдача */}
            {modal === "handover" && (
              <HandoverSheet
                trucks={trucks}
                activeSession={activeSession}
                onClose={() => setModal(null)}
                onDone={(newSession) => {
                  setActiveSession(newSession);
                  setModal(null);
                  loadData();
                }}
              />
            )}

            {/* Профиль */}
            {modal === "profile" && (
              <div>
                <SheetHeader title="Мой профиль" onClose={() => setModal(null)} />
                {profileLoading ? (
                  <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-3)" }}>Загрузка…</div>
                ) : profile ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {[
                      ["ФИО", [profile.last_name, profile.first_name, profile.middle_name].filter(Boolean).join(" ")],
                      ["Паспорт", profile.passport_number],
                      ["Выдан", fmtDate(profile.passport_issued_date)],
                      ["ВУ", profile.license_number],
                      ["ВУ выдано", fmtDate(profile.license_issued_date)],
                      ["ВУ действует до", fmtDate(profile.license_valid_until)],
                      ["СКЗИ", profile.skzi_card_number],
                      ["СКЗИ до", fmtDate(profile.skzi_valid_until)],
                    ].map(([label, val]) => (
                      <div key={label} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "baseline",
                        padding: "10px 0", borderBottom: "1px solid var(--line-row)",
                      }}>
                        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{label}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", textAlign: "right", maxWidth: "60%" }}>
                          {val || "—"}
                        </span>
                      </div>
                    ))}
                    {profile.payment_terms?.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "var(--font-mono)", color: "var(--text-4)", margin: "12px 0 8px" }}>
                          Условия оплаты
                        </div>
                        {profile.payment_terms.map((pt, i) => (
                          <div key={i} style={{
                            background: "var(--surface-2)", borderRadius: "var(--r-md)",
                            padding: "10px 14px", marginBottom: 8, fontSize: 13,
                          }}>
                            <div style={{ fontWeight: 600 }}>{pt.carrier}</div>
                            <div style={{ color: "var(--text-2)" }}>
                              {pt.rate_type} · {pt.rate_value}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                    Данные профиля не найдены
                  </div>
                )}
                <SBtn variant="secondary" onClick={() => setModal("changepass")} style={{ marginTop: 16 }}>
                  Сменить пароль
                </SBtn>
                <SBtn variant="danger" onClick={() => { logout(); navigate("/login", { replace: true }); }} style={{ marginTop: 10 }}>
                  Выйти
                </SBtn>
              </div>
            )}

            {/* Смена пароля */}
            {modal === "changepass" && (
              <div>
                <SheetHeader title="Смена пароля" onClose={() => setModal(null)} />
                {cpOk ? (
                  <SuccessScreen text="Пароль изменён!" onClose={() => setModal(null)} />
                ) : (
                  <>
                    {cpError && (
                      <div style={{ background: "var(--danger-bg)", color: "var(--danger)", borderRadius: "var(--r-md)", padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
                        {cpError}
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                      <input type="password" style={inputStyle} placeholder="Текущий пароль" value={cpOld} onChange={e => setCpOld(e.target.value)} />
                      <input type="password" style={inputStyle} placeholder="Новый пароль (мин. 6)" value={cpNew} onChange={e => setCpNew(e.target.value)} />
                      <input type="password" style={inputStyle} placeholder="Повторите пароль" value={cpNew2} onChange={e => setCpNew2(e.target.value)} />
                    </div>
                    <SBtn onClick={handleChangePassword} disabled={cpSaving}>
                      {cpSaving ? "Сохранение…" : "Сменить пароль"}
                    </SBtn>
                  </>
                )}
              </div>
            )}

            {/* Сводка по машине */}
            {modal === "truckinfo" && (
              <div>
                <SheetHeader
                  title={truckInfo?.plate || "Машина"}
                  sub={truckInfo ? `${truckInfo.brand || ""} ${truckInfo.year || ""}`.trim() || undefined : undefined}
                  onClose={() => setModal(null)}
                />
                {truckInfo ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {[
                      ["Модель", `${truckInfo.brand} ${truckInfo.year || ""}`],
                      ["Тип кузова", truckInfo.body_type],
                      ["VIN", truckInfo.vin],
                    ].map(([label, val]) => (
                      <div key={label} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "baseline",
                        padding: "10px 0", borderBottom: "1px solid var(--line-row)",
                      }}>
                        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{label}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", fontFamily: "var(--font-mono)", textAlign: "right" }}>
                          {val || "—"}
                        </span>
                      </div>
                    ))}

                    {/* Документы */}
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.8, padding: "14px 0 6px" }}>
                      Документы
                    </div>
                    {[
                      { label: "СТС", doc: truckInfo.sts },
                      { label: "ОСАГО", doc: truckInfo.osago },
                      { label: "Карта ТехОсмотра", doc: truckInfo.tech_inspection },
                    ].map(({ label, doc }) => (
                      <div key={label} style={{
                        background: "var(--surface)", border: "1px solid var(--line)",
                        borderRadius: 12, padding: "12px 14px", marginBottom: 6,
                        display: "flex", alignItems: "center", gap: 12,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 }}>
                            {label}
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                            {doc?.number || "Номер не указан"}
                          </div>
                          {doc?.date && (
                            <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>
                              до {fmtDate(doc.date)}
                            </div>
                          )}
                        </div>
                        {doc?.scan_path ? (
                          <a
                            href={fileUrl(doc.scan_path.startsWith("/") ? doc.scan_path : `/truck-scans/${doc.scan_path}`)}
                            download
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              background: "var(--invert)", color: "var(--on-invert)",
                              borderRadius: 10, padding: "8px 14px",
                              fontSize: 13, fontWeight: 600, textDecoration: "none", flexShrink: 0,
                            }}
                          >
                            Скачать
                          </a>
                        ) : (
                          <span style={{
                            background: "var(--surface-2)", color: "var(--text-3)",
                            borderRadius: 10, padding: "8px 14px",
                            fontSize: 13, fontWeight: 600, flexShrink: 0,
                          }}>
                            Нет файла
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text-3)" }}>Нет данных</div>
                )}
                <SBtn onClick={() => setModal(null)} style={{ marginTop: 16 }}>Закрыть</SBtn>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
