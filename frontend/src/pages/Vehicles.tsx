// Автомобили — раньше статичный карточный список демо-техники
// (data/fleet.ts/VehicleCard.tsx, портировано из design_handoff_fleet_dashboard).
// Перестроено 2026-06-23 в настоящий CRUD-экран над /api/trucks/, по образцу
// вкладки "Перевозчики" в Directories.tsx (таблица + модалка-форма). Демо-данные
// в data/fleet.ts не тронуты — Dashboard.tsx по-прежнему их использует
// (#55, отдельная задача на подключение живых данных там).
//
// Страница теперь сама рисует свой .pagehead (с реальным "Добавить
// автомобиль"), а не через AppShell-овский META-хедер — см. AppShell.tsx,
// запись "/vehicles" там убрана.
//
// 2026-06-24: добавлены VIN/Шасси/№ПТС-ЭПТС/№СТС (структурированные поля,
// вынесенные из свободного текста notes — данные перенесены в базу),
// № СТС выведен отдельной колонкой в таблице, и добавлено
// переключение таблица/карточки. Карточный вид воссоздаёт дизайн старого
// статичного VehicleCard.tsx (см. скриншот в задаче) поверх настоящих
// данных — но т.к. статус/одометр/пробег за день/топливо% у настоящих
// Truck нет (это были демо-данные), эти блоки рендерятся с заглушкой "—"
// вместо новых полей в БД (подтверждено пользователем).
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError, logDownload, fileUrl } from "../api";
import Icon from "../components/Icon";

// Дублирует backend/app/models.py::VEHICLE_TYPES/BODY_TYPES (тот же приём,
// что и SOURCES в Trips.tsx / CASHFLOW_CATEGORIES в Expenses.tsx) — точные
// формулировки заданы пользователем, включая написание "Рефрежиратор".
const VEHICLE_TYPES = ["Грузовой", "Легковой", "Фура"];
const BODY_TYPES = ["Тент", "Рефрежиратор", "Изотерма", "Фургон", "Прицеп"];

type Truck = {
  id: number;
  label: string;
  plate: string;
  brand: string;
  year: number | null;
  vehicle_type: string;
  body_type: string;
  maintenance_interval_km: number | null;
  osago_date: string | null;
  kasko_date: string | null;
  tech_inspection_date: string | null;
  vin: string;
  chassis_number: string;
  pts_number: string;
  sts_number: string;
  sts_date: string | null;
  osago_number: string;
  kasko_number: string;
  tech_inspection_number: string;
  sts_scan: string;
  osago_scan: string;
  kasko_scan: string;
  tech_inspection_scan: string;
  moscow_pass_date: string | null;
  notes: string;
};

type TruckFormState = {
  brand: string;
  plate: string;
  vehicle_type: string;
  body_type: string;
  year: string;
  maintenance_interval_km: string;
  osago_date: string;
  kasko_date: string;
  tech_inspection_date: string;
  vin: string;
  chassis_number: string;
  pts_number: string;
  sts_number: string;
  sts_date: string;
  osago_number: string;
  kasko_number: string;
  tech_inspection_number: string;
  moscow_pass_date: string;
  notes: string;
};

const EMPTY_FORM: TruckFormState = {
  brand: "",
  plate: "",
  vehicle_type: VEHICLE_TYPES[0],
  body_type: "",
  year: "",
  maintenance_interval_km: "",
  osago_date: "",
  kasko_date: "",
  tech_inspection_date: "",
  vin: "",
  chassis_number: "",
  pts_number: "",
  sts_number: "",
  sts_date: "",
  osago_number: "",
  kasko_number: "",
  tech_inspection_number: "",
  moscow_pass_date: "",
  notes: "",
};

function truckToForm(t: Truck): TruckFormState {
  return {
    brand: t.brand || "",
    plate: t.plate || "",
    vehicle_type: t.vehicle_type || VEHICLE_TYPES[0],
    body_type: t.body_type || "",
    year: t.year != null ? String(t.year) : "",
    maintenance_interval_km: t.maintenance_interval_km != null ? String(t.maintenance_interval_km) : "",
    osago_date: t.osago_date || "",
    kasko_date: t.kasko_date || "",
    tech_inspection_date: t.tech_inspection_date || "",
    moscow_pass_date: t.moscow_pass_date || "",
    vin: t.vin || "",
    chassis_number: t.chassis_number || "",
    pts_number: t.pts_number || "",
    sts_number: t.sts_number || "",
    sts_date: t.sts_date || "",
    osago_number: t.osago_number || "",
    kasko_number: t.kasko_number || "",
    tech_inspection_number: t.tech_inspection_number || "",
    notes: t.notes || "",
  };
}

function toPayload(f: TruckFormState) {
  const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
  const dateOrNull = (s: string) => (s ? s : null);
  return {
    brand: f.brand,
    plate: f.plate,
    vehicle_type: f.vehicle_type,
    body_type: f.body_type,
    year: numOrNull(f.year),
    maintenance_interval_km: numOrNull(f.maintenance_interval_km),
    osago_date: dateOrNull(f.osago_date),
    kasko_date: dateOrNull(f.kasko_date),
    tech_inspection_date: dateOrNull(f.tech_inspection_date),
    vin: f.vin,
    chassis_number: f.chassis_number,
    pts_number: f.pts_number,
    sts_number: f.sts_number,
    sts_date: dateOrNull(f.sts_date),
    osago_number: f.osago_number,
    kasko_number: f.kasko_number,
    tech_inspection_number: f.tech_inspection_number,
    moscow_pass_date: dateOrNull(f.moscow_pass_date),
    notes: f.notes,
  };
}

function displayName(t: Truck): string {
  return t.brand || t.label || t.plate || "Без названия";
}

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("ru-RU") : "—");
const isOverdue = (d: string | null) => !!d && new Date(d) < new Date();

// ── Статистика машин (одометр / ТО / топливо за неделю) ──────────────────────
type TruckStat = {
  last_odometer: number | null;
  last_service_odometer: number | null;
  fuel_week_liters: number;
};

// ── Активные сессии (приёмка-передача авто) ───────────────────────────────────
type ActiveSession = {
  session_id: number; truck_id: number; driver_id: number;
  driver_name: string; started_at: string;
};
// Типы для просмотра акта П/П (аналогичны Trips.tsx, но изолированы)
type VInspItem = { id: number; block: number; label: string; status: string; note: string; item_count: number | null };
type VInspDamage = { id: number; description: string; photo_path: string };
type VInspDetail = {
  id: number; session_id: number | null; driver_id: number; truck_id: number;
  kind: string; odometer: number | null; created_at: string;
  items: VInspItem[]; damages: VInspDamage[];
};
type VSessionDetail = {
  id: number; driver_id: number; driver_name: string;
  truck_id: number; truck_plate: string; truck_label: string;
  started_at: string; ended_at: string | null;
  start_inspection: VInspDetail | null;
  end_inspection: VInspDetail | null;
};
const V_BLOCK_NAMES: Record<number, string> = {
  1: "Состояние авто", 2: "Документы", 3: "Комплектация", 4: "Чистота", 5: "Такелаж",
};
const V_CLEAN_LABEL: Record<string, string> = { clean: "Чисто", medium: "Средне", dirty: "Грязно" };
const V_CLEAN_COLOR: Record<string, { bg: string; text: string }> = {
  clean:  { bg: "#27ae6018", text: "#27ae60" },
  medium: { bg: "#f39c1218", text: "#f39c12" },
  dirty:  { bg: "#e74c3c18", text: "#e74c3c" },
};

export default function Vehicles({ tabsNav }: { tabsNav?: ReactNode } = {}) {
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "cards">("table");

  const [fleetStats, setFleetStats] = useState<Map<number, TruckStat>>(new Map());
  const [activeSessions, setActiveSessions] = useState<Map<number, ActiveSession>>(new Map());
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TruckFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Сканы документов: храним текущие имена файлов (пусто = скан не загружен).
  // При редактировании инициализируются из данных машины (openEdit).
  // При создании пустые; загрузка доступна только после первого сохранения.
  type ScanKey = "sts_scan" | "osago_scan" | "kasko_scan" | "tech_inspection_scan";
  const [scans, setScans] = useState<Record<ScanKey, string>>({
    sts_scan: "", osago_scan: "", kasko_scan: "", tech_inspection_scan: "",
  });
  const [scanUploading, setScanUploading] = useState<Record<ScanKey, boolean>>({
    sts_scan: false, osago_scan: false, kasko_scan: false, tech_inspection_scan: false,
  });
  const scanFileRefs = useRef<Partial<Record<ScanKey, HTMLInputElement | null>>>({});

  async function uploadScan(docType: "sts" | "osago" | "kasko" | "tech_inspection", file: File) {
    if (!editingId) return;
    const key = `${docType}_scan` as ScanKey;
    setScanUploading((s) => ({ ...s, [key]: true }));
    try {
      const res = await api.upload<{ filename: string }>(`/api/trucks/${editingId}/scan/${docType}`, file);
      setScans((s) => ({ ...s, [key]: res.filename }));
    } catch {
      /* тихо — файл не загрузится, пользователь попробует снова */
    } finally {
      setScanUploading((s) => ({ ...s, [key]: false }));
    }
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const t = await api.get<Truck[]>("/api/trucks/");
      setTrucks(t);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    api.get<ActiveSession[]>("/api/vehicle-inspections/active-sessions")
      .then(list => setActiveSessions(new Map(list.map(s => [s.truck_id, s]))))
      .catch(() => {});
    api.get<Record<string, TruckStat>>("/api/trucks/fleet-stats")
      .then(raw => setFleetStats(new Map(Object.entries(raw).map(([k, v]) => [Number(k), v]))))
      .catch(() => {});
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setScans({ sts_scan: "", osago_scan: "", kasko_scan: "", tech_inspection_scan: "" });
    setModalOpen(true);
  }

  function openEdit(t: Truck) {
    setEditingId(t.id);
    setForm(truckToForm(t));
    setFormError(null);
    setScans({
      sts_scan: t.sts_scan || "",
      osago_scan: t.osago_scan || "",
      kasko_scan: t.kasko_scan || "",
      tech_inspection_scan: t.tech_inspection_scan || "",
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function setFieldValue<K extends keyof TruckFormState>(key: K, value: TruckFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    if (!form.brand.trim() && !form.plate.trim()) {
      setFormError("Укажите хотя бы название или гос. номер");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = toPayload(form);
      if (editingId) {
        await api.put(`/api/trucks/${editingId}`, payload);
      } else {
        await api.post("/api/trucks/", payload);
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
    if (!window.confirm("Удалить автомобиль? Связанные рейсы и заправки останутся, но потеряют привязку к машине.")) return;
    setSaving(true);
    setFormError(null);
    try {
      await api.delete(`/api/trucks/${editingId}`);
      setModalOpen(false);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Ошибка удаления");
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return trucks;
    return trucks.filter((t) => [displayName(t), t.plate, t.vehicle_type, t.body_type].some((v) => (v || "").toLowerCase().includes(q)));
  }, [trucks, search]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => displayName(a).localeCompare(displayName(b), "ru")), [filtered]);

  return (
    <div>
      {/* 2026-06-28: собственный pagehead убран - страница теперь живёт как
          вкладка «Автомобили» внутри Справочники (см. pages/Directories.tsx),
          которая рисует общий заголовок/крошки и передаёт сюда переключатель
          вкладок (tabsNav) - рисуем его в той же строке, что и кнопки
          действий, вместо отдельной строки над ними (не тратим высоту). */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {tabsNav}
          <span style={{ color: "var(--ink-3)", fontSize: 13 }}>Парк · {trucks.length} единиц</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={`pill-btn${view === "table" ? " solid" : ""}`}
            title="Список"
            onClick={() => setView("table")}
          >
            <Icon name="list" size={17} />
          </button>
          <button
            type="button"
            className={`pill-btn${view === "cards" ? " solid" : ""}`}
            title="Карточки"
            onClick={() => setView("cards")}
          >
            <Icon name="grid" size={17} />
          </button>
          <button className="pill-btn solid" onClick={openCreate}>
            <Icon name="plus" size={17} /> <span className="lbl-hide">Добавить автомобиль</span>
          </button>
        </div>
      </div>

      {error && (
        <p className="fcard" style={{ color: "var(--ember)", marginBottom: 24 }}>
          {error}
        </p>
      )}

      <div className="fcard" style={{ marginBottom: 16 }}>
        <label className="label">Поиск</label>
        <input
          type="text"
          className="input"
          placeholder="Название, гос. номер, вид, надстройка..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 360 }}
        />
      </div>

      {view === "table" ? (
        <div className="fcard" style={{ padding: 0 }}>
          {loading ? (
            <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>Загрузка...</p>
          ) : trucks.length === 0 ? (
            <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>Пока нет автомобилей. Добавьте первый.</p>
          ) : sorted.length === 0 ? (
            <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>Ничего не найдено.</p>
          ) : (
            <div style={{ overflowX: "auto", padding: "16px 20px" }}>
              <table>
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>Гос. номер</th>
                    <th>№ СТС</th>
                    <th>Вид</th>
                    <th>Надстройка</th>
                    <th>Год</th>
                    <th>Интервал ТО</th>
                    <th>Одометр</th>
                    <th>До ТО</th>
                    <th>Топливо нед.</th>
                    <th>ОСАГО</th>
                    <th>КАСКО</th>
                    <th>ТехОсмотр</th>
                    <th>Пропуск МСК</th>
                    <th>Водитель</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t) => {
                    const stat = fleetStats.get(t.id);
                    const curOdo = stat?.last_odometer ?? null;
                    const svcOdo = stat?.last_service_odometer ?? null;
                    const intervalKm = t.maintenance_interval_km;
                    const usedSinceService = curOdo != null ? curOdo - (svcOdo ?? 0) : null;
                    const kmToService = intervalKm && usedSinceService != null
                      ? intervalKm - usedSinceService : null;
                    const servicePct = intervalKm && usedSinceService != null
                      ? Math.min(100, (usedSinceService / intervalKm) * 100) : null;
                    const serviceColor = servicePct == null ? undefined
                      : servicePct >= 90 ? "var(--bad-ink)"
                      : servicePct >= 70 ? "var(--warn-ink)"
                      : undefined;
                    return (
                    <tr key={t.id} onClick={() => openEdit(t)} style={{ cursor: "pointer" }}>
                      <td>{displayName(t)}</td>
                      <td>{t.plate || "—"}</td>
                      <td>{t.sts_number || "—"}</td>
                      <td>{t.vehicle_type || "—"}</td>
                      <td>{t.body_type || "—"}</td>
                      <td>{t.year ?? "—"}</td>
                      <td>{intervalKm != null ? `${intervalKm.toLocaleString("ru-RU")} км` : "—"}</td>
                      <td>{curOdo != null ? `${Math.round(curOdo).toLocaleString("ru-RU")} км` : "—"}</td>
                      <td style={{ color: serviceColor }}>
                        {kmToService != null
                          ? kmToService > 0
                            ? `${Math.round(kmToService).toLocaleString("ru-RU")} км`
                            : "Просрочено"
                          : intervalKm ? "нет данных" : "—"}
                      </td>
                      <td>{stat && stat.fuel_week_liters > 0 ? `${stat.fuel_week_liters} л` : "—"}</td>
                      <td style={{ color: isOverdue(t.osago_date) ? "var(--bad-ink)" : undefined }}>{fmtDate(t.osago_date)}</td>
                      <td style={{ color: isOverdue(t.kasko_date) ? "var(--bad-ink)" : undefined }}>{fmtDate(t.kasko_date)}</td>
                      <td style={{ color: isOverdue(t.tech_inspection_date) ? "var(--bad-ink)" : undefined }}>{fmtDate(t.tech_inspection_date)}</td>
                      <td style={{ color: isOverdue(t.moscow_pass_date) ? "var(--bad-ink)" : undefined }}>{fmtDate(t.moscow_pass_date)}</td>
                      <td onClick={(e) => { const s = activeSessions.get(t.id); if (s) { e.stopPropagation(); setSelectedSessionId(s.session_id); } }}>
                        {activeSessions.get(t.id) ? (
                          <button type="button" style={{
                            background: "rgba(39,174,96,.12)", border: "none", borderRadius: 8,
                            padding: "2px 8px", fontSize: 12, fontWeight: 600,
                            color: "#27ae60", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                          }}>
                            🟢 {activeSessions.get(t.id)!.driver_name}
                          </button>
                        ) : <span style={{ color: "var(--ink-3)" }}>—</span>}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : loading ? (
        <p style={{ color: "var(--ink-3)" }}>Загрузка...</p>
      ) : trucks.length === 0 ? (
        <p style={{ color: "var(--ink-3)" }}>Пока нет автомобилей. Добавьте первый.</p>
      ) : sorted.length === 0 ? (
        <p style={{ color: "var(--ink-3)" }}>Ничего не найдено.</p>
      ) : (
        <div className="list-grid">
          {sorted.map((t) => {
            const stat = fleetStats.get(t.id);
            const sess = activeSessions.get(t.id);
            // До ТО: нужен интервал ТО и хотя бы одометр
            const intervalKm = t.maintenance_interval_km;
            const curOdo = stat?.last_odometer ?? null;
            const svcOdo = stat?.last_service_odometer ?? null;
            // км накопленных с последнего ТО (или с 0 если нет записи ТО)
            const usedSinceService = curOdo != null ? (curOdo - (svcOdo ?? 0)) : null;
            const kmToService = intervalKm && usedSinceService != null
              ? intervalKm - usedSinceService : null;
            const servicePct = intervalKm && usedSinceService != null
              ? Math.min(100, Math.round((usedSinceService / intervalKm) * 100)) : null;
            const serviceColor = servicePct == null ? "var(--ink-3)"
              : servicePct >= 90 ? "var(--bad)"
              : servicePct >= 70 ? "var(--warn)"
              : "var(--accent)";

            const fmtOdo = (v: number | null) =>
              v != null ? `${Math.round(v).toLocaleString("ru-RU")} км` : "—";

            return (
            <div key={t.id} className="vcard" onClick={() => openEdit(t)} style={{ cursor: "pointer" }}>
              <div className="vcard-top">
                <span className="vthumb">
                  <Icon name="truck" size={28} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="vname">{displayName(t)}</div>
                  <div className="vplate">{t.plate || "—"}</div>
                </div>
              </div>

              {sess ? (
                <button
                  type="button"
                  className="status st-route"
                  style={{ cursor: "pointer", border: "none", fontFamily: "inherit" }}
                  onClick={(e) => { e.stopPropagation(); setSelectedSessionId(sess.session_id); }}
                >
                  <span className="sd" />
                  В пути · {sess.driver_name}
                </button>
              ) : (
                <span className="status st-free">
                  <span className="sd" style={{ background: "var(--ink-3)" }} />
                  На базе
                </span>
              )}

              <div className="vmeta">
                <div className="m">
                  <div className="l">Водитель</div>
                  <div className="v sm">
                    {sess ? (
                      <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedSessionId(sess.session_id); }} style={{
                        background: "none", border: "none", padding: 0, cursor: "pointer",
                        color: "var(--iris)", fontWeight: 600, fontSize: "inherit",
                      }}>
                        {sess.driver_name}
                      </button>
                    ) : "—"}
                  </div>
                </div>
                <div className="m">
                  <div className="l">Одометр</div>
                  <div className="v">{fmtOdo(curOdo)}</div>
                </div>
                <div className="m">
                  <div className="l">Посл. ТО</div>
                  <div className="v">{fmtOdo(svcOdo)}</div>
                </div>
                <div className="m">
                  <div className="l">Топливо нед.</div>
                  <div className="v">
                    {stat && stat.fuel_week_liters > 0 ? `${stat.fuel_week_liters} л` : "—"}
                  </div>
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: "var(--ink-3)", fontWeight: 600, fontSize: "0.78rem" }}>До ТО</span>
                  <span style={{ color: serviceColor, fontWeight: 600, fontSize: "0.78rem" }}>
                    {kmToService != null
                      ? kmToService > 0
                        ? `${Math.round(kmToService).toLocaleString("ru-RU")} км`
                        : "Просрочено"
                      : intervalKm ? "нет данных" : "—"}
                  </span>
                </div>
                <div className="progress">
                  <i style={{ width: `${servicePct ?? 0}%`, background: serviceColor, transition: "width .4s" }} />
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {selectedSessionId !== null && (
        <VehSessionDetailModal sessionId={selectedSessionId} onClose={() => setSelectedSessionId(null)} />
      )}

      {modalOpen && (
        <div className="modal-overlay">
          <div className="fcard" style={{ width: 700, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", padding: 0 }}>
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
              <h2 style={{ fontSize: 18, margin: 0 }}>{editingId ? "Карточка автомобиля" : "Новый автомобиль"}</h2>
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
                <TextField label="Название" value={form.brand} onChange={(v) => setFieldValue("brand", v)} />
                <TextField label="Гос. номер" value={form.plate} onChange={(v) => setFieldValue("plate", v)} />
              </Row>

              <Row>
                <SelectField label="Вид" value={form.vehicle_type} options={VEHICLE_TYPES} onChange={(v) => setFieldValue("vehicle_type", v)} />
                <SelectField
                  label="Надстройка"
                  value={form.body_type}
                  options={BODY_TYPES}
                  emptyLabel="— нет —"
                  onChange={(v) => setFieldValue("body_type", v)}
                />
              </Row>

              <Row>
                <TextField label="VIN" value={form.vin} onChange={(v) => setFieldValue("vin", v)} />
                <TextField label="Шасси" value={form.chassis_number} onChange={(v) => setFieldValue("chassis_number", v)} />
              </Row>

              <Row>
                <TextField label="№ ПТС / ЭПТС" value={form.pts_number} onChange={(v) => setFieldValue("pts_number", v)} />
                <TextField label="№ СТС" value={form.sts_number} onChange={(v) => setFieldValue("sts_number", v)} />
              </Row>

              <Row>
                <TextField label="Год выпуска" type="number" value={form.year} onChange={(v) => setFieldValue("year", v)} />
                <TextField
                  label="Интервал ТО, км"
                  type="number"
                  value={form.maintenance_interval_km}
                  onChange={(v) => setFieldValue("maintenance_interval_km", v)}
                />
              </Row>

              {/* Блок документов (2026-07-03) */}
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: "var(--ink-3)",
                  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
                }}>
                  Документы
                </div>
                <DocScanBlock
                  label="СТС"
                  docType="sts"
                  numberValue={form.sts_number}
                  dateValue={form.sts_date}
                  scanFilename={scans.sts_scan}
                  uploading={scanUploading.sts_scan}
                  canUpload={!!editingId}
                  onNumberChange={(v) => setFieldValue("sts_number", v)}
                  onDateChange={(v) => setFieldValue("sts_date", v)}
                  onFileChange={(f) => uploadScan("sts", f)}
                  scanRef={(el) => { scanFileRefs.current.sts_scan = el; }}
                />
                <DocScanBlock
                  label="ОСАГО"
                  docType="osago"
                  numberValue={form.osago_number}
                  dateValue={form.osago_date}
                  scanFilename={scans.osago_scan}
                  uploading={scanUploading.osago_scan}
                  canUpload={!!editingId}
                  onNumberChange={(v) => setFieldValue("osago_number", v)}
                  onDateChange={(v) => setFieldValue("osago_date", v)}
                  onFileChange={(f) => uploadScan("osago", f)}
                  scanRef={(el) => { scanFileRefs.current.osago_scan = el; }}
                />
                <DocScanBlock
                  label="КАСКО"
                  docType="kasko"
                  numberValue={form.kasko_number}
                  dateValue={form.kasko_date}
                  scanFilename={scans.kasko_scan}
                  uploading={scanUploading.kasko_scan}
                  canUpload={!!editingId}
                  onNumberChange={(v) => setFieldValue("kasko_number", v)}
                  onDateChange={(v) => setFieldValue("kasko_date", v)}
                  onFileChange={(f) => uploadScan("kasko", f)}
                  scanRef={(el) => { scanFileRefs.current.kasko_scan = el; }}
                />
                <DocScanBlock
                  label="ТехОсмотр"
                  docType="tech_inspection"
                  numberValue={form.tech_inspection_number}
                  dateValue={form.tech_inspection_date}
                  scanFilename={scans.tech_inspection_scan}
                  uploading={scanUploading.tech_inspection_scan}
                  canUpload={!!editingId}
                  onNumberChange={(v) => setFieldValue("tech_inspection_number", v)}
                  onDateChange={(v) => setFieldValue("tech_inspection_date", v)}
                  onFileChange={(f) => uploadScan("tech_inspection", f)}
                  scanRef={(el) => { scanFileRefs.current.tech_inspection_scan = el; }}
                />
                <DocScanBlock
                  label="Пропуск МСК"
                  docType="moscow_pass"
                  numberValue=""
                  dateValue={form.moscow_pass_date}
                  scanFilename=""
                  uploading={false}
                  canUpload={false}
                  onNumberChange={() => {}}
                  onDateChange={(v) => setFieldValue("moscow_pass_date", v)}
                  onFileChange={() => {}}
                  scanRef={() => {}}
                />
              </div>

              <Row>
                <TextAreaField label="Примечание" value={form.notes} onChange={(v) => setFieldValue("notes", v)} />
              </Row>

              {formError && <p style={{ color: "var(--ember)", fontSize: 13, margin: "0 0 12px" }}>{formError}</p>}

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
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// VehInspectionView + VehSessionDetailModal — просмотр акта П/П (аналог Trips.tsx)
// ──────────────────────────────────────────────────────────────────────────────
function VehInspectionView({ insp }: { insp: VInspDetail }) {
  const regularDamages = insp.damages.filter(d => !d.description.startsWith("Фото чистоты:") && !d.description.startsWith("4 стороны:"));
  const sidePhotos = insp.damages.filter(d => d.description.startsWith("4 стороны:"));
  const cleanPhotos = insp.damages.filter(d => d.description.startsWith("Фото чистоты:"));

  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--smoke)", marginBottom: 12 }}>
        Одометр: <strong>{insp.odometer != null ? `${insp.odometer.toLocaleString("ru-RU")} км` : "не указан"}</strong>
      </div>
      {[1, 2, 3, 4, 5].map(blockNum => {
        const items = insp.items.filter(it => it.block === blockNum);
        if (items.length === 0) return null;
        const isClean = blockNum === 4;
        return (
          <div key={blockNum} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--smoke)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
              {V_BLOCK_NAMES[blockNum]}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {items.map(it => {
                  const ok = it.status === "yes";
                  const bad = it.status === "no";
                  const cleanColor = isClean ? V_CLEAN_COLOR[it.status] : null;
                  const cPhoto = isClean ? cleanPhotos.find(d => d.description === `Фото чистоты: ${it.label}`) : null;
                  return (
                    <tr key={it.id} style={{ borderBottom: "1px solid var(--outline)" }}>
                      <td style={{ padding: "6px 4px", fontSize: 13, color: "var(--ink)" }}>
                        {it.label}
                        {it.note && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--smoke)", fontStyle: "italic" }}>{it.note}</span>}
                        {it.item_count != null && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--smoke)" }}>{it.item_count} шт.</span>}
                        {cPhoto && <a href={fileUrl(`/photos/${cPhoto.photo_path}`)} target="_blank" rel="noreferrer" style={{ marginLeft: 8, fontSize: 11, color: "var(--iris)", textDecoration: "none" }}>📷</a>}
                      </td>
                      <td style={{ padding: "6px 4px", textAlign: "right", whiteSpace: "nowrap" }}>
                        {isClean ? (
                          <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: cleanColor?.bg ?? "var(--surface)", color: cleanColor?.text ?? "var(--smoke)" }}>
                            {V_CLEAN_LABEL[it.status] ?? "—"}
                          </span>
                        ) : (
                          <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, background: ok ? "#27ae6018" : bad ? "#e74c3c18" : "var(--surface)", color: ok ? "#27ae60" : bad ? "#e74c3c" : "var(--smoke)" }}>
                            {ok ? "✓ ДА" : bad ? "✗ НЕТ" : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {sidePhotos.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--smoke)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Фото с 4 сторон</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {sidePhotos.map(d => (
              <a key={d.id} href={fileUrl(`/photos/${d.photo_path}`)} target="_blank" rel="noreferrer" style={{ display: "block", padding: "10px 8px", textAlign: "center", background: "var(--surface)", borderRadius: 8, border: "1px solid var(--outline)", color: "var(--iris)", fontSize: 13, textDecoration: "none", fontWeight: 600 }}>
                📷 {d.description.replace("4 стороны: ", "")}
              </a>
            ))}
          </div>
        </div>
      )}
      {regularDamages.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--smoke)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>Повреждения</div>
          {regularDamages.map(d => (
            <div key={d.id} style={{ padding: "8px 10px", marginBottom: 6, background: "var(--surface)", borderRadius: 8, border: "1px solid var(--outline)" }}>
              <div style={{ fontSize: 13, color: "var(--ink)", marginBottom: d.photo_path ? 4 : 0 }}>{d.description || <span style={{ color: "var(--smoke)" }}>Без описания</span>}</div>
              {d.photo_path && <a href={fileUrl(`/photos/${d.photo_path}`)} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--iris)", textDecoration: "none" }}>📷 Открыть фото</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VehSessionDetailModal({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<VSessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<VSessionDetail>(`/api/vehicle-inspections/sessions/${sessionId}`)
      .then(setDetail)
      .catch(err => setError(err instanceof ApiError ? err.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [sessionId]);

  function fmtDT(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fcard" style={{ width: 640, maxWidth: "95vw", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Акт приёмки-сдачи</h2>
          <button onClick={onClose} style={{ background: "var(--surface)", border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 18, display: "grid", placeItems: "center", color: "var(--smoke)" }}>×</button>
        </div>

        {loading && <p style={{ color: "var(--smoke)" }}>Загрузка...</p>}
        {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
        {detail && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20, padding: "12px 14px", background: "var(--surface)", borderRadius: 10, border: "1px solid var(--outline)" }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--smoke)", marginBottom: 2 }}>Водитель</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{detail.driver_name || `#${detail.driver_id}`}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--smoke)", marginBottom: 2 }}>Машина</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {detail.truck_plate}
                  {detail.truck_label && detail.truck_label !== detail.truck_plate && (
                    <span style={{ fontWeight: 400, color: "var(--smoke)", marginLeft: 6 }}>{detail.truck_label}</span>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--smoke)", marginBottom: 2 }}>Статус</div>
                <span className={`tag ${detail.ended_at ? "tag-neutral" : "tag-iris"}`}>{detail.ended_at ? "Завершена" : "Активна"}</span>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--smoke)", marginBottom: 2 }}>Принята</div>
                <div style={{ fontSize: 13 }}>{fmtDT(detail.started_at)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--smoke)", marginBottom: 2 }}>Сдана</div>
                <div style={{ fontSize: 13 }}>{fmtDT(detail.ended_at)}</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: detail.end_inspection ? "1fr 1fr" : "1fr", gap: 20 }}>
              {detail.start_inspection && (
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, paddingBottom: 8, borderBottom: "2px solid #27ae60", color: "#27ae60" }}>📋 Акт приёмки</div>
                  <VehInspectionView insp={detail.start_inspection} />
                </div>
              )}
              {detail.end_inspection && (
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, paddingBottom: 8, borderBottom: "2px solid var(--iris)", color: "var(--iris)" }}>🔑 Акт сдачи</div>
                  <VehInspectionView insp={detail.end_inspection} />
                </div>
              )}
              {!detail.start_inspection && !detail.end_inspection && (
                <p style={{ color: "var(--smoke)", fontSize: 13 }}>Актов нет</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// DocScanBlock — строка «Номер · Дата · Прикрепить скан» для одного документа
// ──────────────────────────────────────────────────────────────────────────────
function DocScanBlock({
  label, docType, numberValue, dateValue, scanFilename,
  uploading, canUpload,
  onNumberChange, onDateChange, onFileChange, scanRef,
}: {
  label: string;
  docType: string;
  numberValue: string;
  dateValue: string;
  scanFilename: string;
  uploading: boolean;
  canUpload: boolean;
  onNumberChange: (v: string) => void;
  onDateChange: (v: string) => void;
  onFileChange: (f: File) => void;
  scanRef: (el: HTMLInputElement | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end",
      padding: "10px 12px", background: "var(--surface)", borderRadius: 10,
      border: "1px solid var(--border)", marginBottom: 8,
    }}>
      {/* Метка */}
      <div style={{ width: 90, flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>
          {label}
        </div>
      </div>
      {/* Номер */}
      <div style={{ flex: "2 1 140px" }}>
        <label className="label" style={{ fontSize: 11 }}>Номер</label>
        <input
          type="text"
          className="input"
          value={numberValue}
          onChange={(e) => onNumberChange(e.target.value)}
          placeholder={`Номер ${label}`}
        />
      </div>
      {/* Дата окончания */}
      <div style={{ flex: "1 1 130px" }}>
        <label className="label" style={{ fontSize: 11 }}>Дата окончания</label>
        <input
          type="date"
          className="input"
          value={dateValue}
          onChange={(e) => onDateChange(e.target.value)}
        />
      </div>
      {/* Скан */}
      <div style={{ flexShrink: 0, display: "flex", gap: 6, alignItems: "center" }}>
        {/* Скрытый file input */}
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.pdf,.webp"
          style={{ display: "none" }}
          ref={(el) => { fileInputRef.current = el; scanRef(el); }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) { onFileChange(f); e.target.value = ""; }
          }}
        />
        {/* Кнопка загрузки */}
        {canUpload ? (
          <button
            type="button"
            className="pill-btn"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            title="Прикрепить скан"
            style={{ fontSize: 12 }}
          >
            {uploading ? "Загрузка..." : scanFilename ? "Заменить скан" : "📎 Прикрепить скан"}
          </button>
        ) : (
          <span style={{ fontSize: 11, color: "var(--ink-3)", fontStyle: "italic" }}>
            Сохраните карточку
          </span>
        )}
        {/* Ссылка скачать, если скан есть */}
        {scanFilename && (
          <a
            href={fileUrl(`/truck-scans/${scanFilename}`)}
            download
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: "var(--iris)", fontWeight: 600 }}
            onClick={() => logDownload(scanFilename, "documents")}
          >
            ↓ Скачать
          </a>
        )}
      </div>
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

function SelectField({
  label,
  value,
  options,
  onChange,
  emptyLabel,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  emptyLabel?: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 160 }}>
      <label className="label">{label}</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
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
