import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ReactNode } from "react";
import { api, ApiError, fileUrl } from "../api";
import { useAuth } from "../auth/AuthContext";
import Icon from "../components/Icon";
import MultiSelect from "../components/MultiSelect";
import { fmtDateTime, isoDate, money, uniqueSorted } from "../lib/format";
import Mileage from "./Mileage";

type Trip = {
  id: number;
  request_number: string;
  external_request_number: string;
  tariff_type: string;
  plate_raw: string;
  truck_id: number | null;
  driver_name_raw: string;
  driver_id: number | null;
  driver_phone: string;
  confirmed_at: string | null;
  status: string;
  dep_at: string;
  end_at: string | null;
  amount: number;
  fines: number;
  source: string;
  carrier_name: string;
};

type Driver = { id: number; name: string };
type Truck = { id: number; label: string; plate?: string };
type Carrier = { id: number; name: string; insurance_pct: number };

type ImportSummary = {
  total_rows: number;
  trips_created: number;
  trips_updated: number;
  skipped_bad_rows: number;
  new_drivers: string[];
  new_trucks: string[];
};

type SortKey = keyof Trip;

// Источник заявки - выбирается пользователем в окне импорта, не приходит
// из файла. Цвета по запросу: OZON синий (переиспользуем --iris), WB
// фиолетовый, ATI зелёный; Прямые/Прочие - нейтральный серый.
const SOURCES: { value: string; tagClass: string }[] = [
  { value: "OZON", tagClass: "tag-iris" },
  { value: "WB", tagClass: "tag-wb" },
  { value: "ATI", tagClass: "tag-ati" },
  { value: "Прямые", tagClass: "tag-neutral" },
  { value: "Прочие", tagClass: "tag-neutral" },
];
const SOURCE_TAG_CLASS: Record<string, string> = Object.fromEntries(SOURCES.map((s) => [s.value, s.tagClass]));

const PAGE_SIZES = [50, 100, 300, 500];

function SourceTag({ source }: { source: string }) {
  const cls = SOURCE_TAG_CLASS[source] || "tag-neutral";
  return <span className={`tag ${cls}`}>{source || "—"}</span>;
}

// «Пробеги» (2026-06-29) - вторая вкладка, «Приёмка-сдача» (2026-07-02) - третья.
type TripsTabId = "registry" | "mileage" | "handover";
const TRIPS_TABS: { id: TripsTabId; label: string }[] = [
  { id: "registry", label: "Реестр поездок" },
  { id: "mileage", label: "Пробеги" },
  { id: "handover", label: "Приёмка-сдача" },
];

// ---------- Журнал приёмки-сдачи ----------
type VehicleSessionRow = {
  id: number;
  driver_id: number;
  driver_name: string;
  truck_id: number;
  truck_plate: string;
  truck_label: string;
  started_at: string;
  ended_at: string | null;
  start_inspection_id: number | null;
  end_inspection_id: number | null;
  start_odometer: number | null;
  end_odometer: number | null;
};

type InspItem = {
  id: number; block: number; label: string;
  status: string; note: string; item_count: number | null;
};
type InspDamage = { id: number; description: string; photo_path: string };
type InspDetail = {
  id: number; session_id: number | null; driver_id: number; truck_id: number;
  kind: string; odometer: number | null; created_at: string;
  items: InspItem[]; damages: InspDamage[];
};
type SessionDetail = {
  id: number; driver_id: number; driver_name: string;
  truck_id: number; truck_plate: string; truck_label: string;
  started_at: string; ended_at: string | null;
  start_inspection: InspDetail | null;
  end_inspection: InspDetail | null;
};

const BLOCK_NAMES: Record<number, string> = {
  1: "Состояние авто",
  2: "Документы",
  3: "Комплектация",
  4: "Чистота",
  5: "Такелаж",
};

const CLEAN_STATUS_LABEL: Record<string, string> = {
  clean: "Чисто",
  medium: "Средне",
  dirty: "Грязно",
};
const CLEAN_STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  clean:  { bg: "#27ae6018", text: "#27ae60" },
  medium: { bg: "#f39c1218", text: "#f39c12" },
  dirty:  { bg: "#e74c3c18", text: "#e74c3c" },
};

function InspectionView({ insp }: { insp: InspDetail }) {
  const blocks = [1, 2, 3, 4, 5];

  // Разделяем damage-записи на "нормальные" и служебные (фото чистоты + 4 стороны)
  const regularDamages = insp.damages.filter(
    d => !d.description.startsWith("Фото чистоты:") && !d.description.startsWith("4 стороны:")
  );
  const sidePhotos = insp.damages.filter(d => d.description.startsWith("4 стороны:"));
  const cleanPhotos = insp.damages.filter(d => d.description.startsWith("Фото чистоты:"));

  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--smoke)", marginBottom: 12 }}>
        Одометр: <strong>{insp.odometer != null ? `${insp.odometer.toLocaleString("ru-RU")} км` : "не указан"}</strong>
      </div>
      {blocks.map(blockNum => {
        const items = insp.items.filter(it => it.block === blockNum);
        if (items.length === 0) return null;
        const isClean = blockNum === 4;
        return (
          <div key={blockNum} style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: "var(--smoke)",
              textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8,
            }}>
              {BLOCK_NAMES[blockNum]}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {items.map(it => {
                  const ok = it.status === "yes";
                  const bad = it.status === "no";
                  const cleanColor = isClean ? CLEAN_STATUS_COLOR[it.status] : null;
                  // фото чистоты для этого пункта
                  const cPhoto = isClean
                    ? cleanPhotos.find(d => d.description === `Фото чистоты: ${it.label}`)
                    : null;
                  return (
                    <tr key={it.id} style={{ borderBottom: "1px solid var(--outline)" }}>
                      <td style={{ padding: "6px 4px", fontSize: 13, color: "var(--ink)" }}>
                        {it.label}
                        {it.note && (
                          <span style={{ marginLeft: 8, fontSize: 11, color: "var(--smoke)", fontStyle: "italic" }}>
                            {it.note}
                          </span>
                        )}
                        {it.item_count != null && (
                          <span style={{ marginLeft: 8, fontSize: 11, color: "var(--smoke)" }}>
                            {it.item_count} шт.
                          </span>
                        )}
                        {cPhoto && (
                          <a
                            href={fileUrl(`/photos/${cPhoto.photo_path}`)}
                            target="_blank" rel="noreferrer"
                            style={{ marginLeft: 8, fontSize: 11, color: "var(--iris)", textDecoration: "none" }}
                          >📷</a>
                        )}
                      </td>
                      <td style={{ padding: "6px 4px", textAlign: "right", whiteSpace: "nowrap" }}>
                        {isClean ? (
                          <span style={{
                            display: "inline-block", padding: "2px 10px", borderRadius: 6,
                            fontSize: 12, fontWeight: 700,
                            background: cleanColor?.bg ?? "var(--surface)",
                            color: cleanColor?.text ?? "var(--smoke)",
                          }}>
                            {CLEAN_STATUS_LABEL[it.status] ?? "—"}
                          </span>
                        ) : (
                          <span style={{
                            display: "inline-block", padding: "2px 10px", borderRadius: 6,
                            fontSize: 12, fontWeight: 700,
                            background: ok ? "#27ae6018" : bad ? "#e74c3c18" : "var(--surface)",
                            color: ok ? "#27ae60" : bad ? "#e74c3c" : "var(--smoke)",
                          }}>
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
      {/* Фото с 4 сторон */}
      {sidePhotos.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: "var(--smoke)",
            textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8,
          }}>
            Фото с 4 сторон
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {sidePhotos.map(d => (
              <a
                key={d.id}
                href={fileUrl(`/photos/${d.photo_path}`)}
                target="_blank" rel="noreferrer"
                style={{
                  display: "block", padding: "10px 8px", textAlign: "center",
                  background: "var(--surface)", borderRadius: 8,
                  border: "1px solid var(--outline)",
                  color: "var(--iris)", fontSize: 13, textDecoration: "none", fontWeight: 600,
                }}
              >
                📷 {d.description.replace("4 стороны: ", "")}
              </a>
            ))}
          </div>
        </div>
      )}
      {/* Повреждения */}
      {regularDamages.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: "var(--smoke)",
            textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8,
          }}>
            Повреждения
          </div>
          {regularDamages.map(d => (
            <div key={d.id} style={{
              padding: "8px 10px", marginBottom: 6,
              background: "var(--surface)", borderRadius: 8,
              border: "1px solid var(--outline)",
            }}>
              <div style={{ fontSize: 13, color: "var(--ink)", marginBottom: d.photo_path ? 4 : 0 }}>
                {d.description || <span style={{ color: "var(--smoke)" }}>Без описания</span>}
              </div>
              {d.photo_path && (
                <a
                  href={fileUrl(`/photos/${d.photo_path}`)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: "var(--iris)", textDecoration: "none" }}
                >
                  📷 Открыть фото
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionDetailModal({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api.get<SessionDetail>(`/api/vehicle-inspections/sessions/${sessionId}`)
      .then(setDetail)
      .catch(err => setError(err instanceof ApiError ? err.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [sessionId]);

  function fmtDT(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div
      className="modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="fcard" style={{ width: 640, maxWidth: "95vw", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Акт приёмки-сдачи</h2>
          <button
            onClick={onClose}
            style={{
              background: "var(--surface)", border: "none", borderRadius: 8,
              width: 32, height: 32, cursor: "pointer", fontSize: 18,
              display: "grid", placeItems: "center", color: "var(--smoke)",
            }}
          >
            ×
          </button>
        </div>

        {loading && <p style={{ color: "var(--smoke)" }}>Загрузка...</p>}
        {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
        {detail && (
          <>
            {/* Шапка сессии */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12, marginBottom: 20, padding: "12px 14px",
              background: "var(--surface)", borderRadius: 10,
              border: "1px solid var(--outline)",
            }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--smoke)", marginBottom: 2 }}>Водитель</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{detail.driver_name || `#${detail.driver_id}`}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--smoke)", marginBottom: 2 }}>Машина</div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {detail.truck_plate}
                  {detail.truck_label && detail.truck_label !== detail.truck_plate && (
                    <span style={{ fontWeight: 400, color: "var(--smoke)", marginLeft: 6 }}>
                      {detail.truck_label}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "var(--smoke)", marginBottom: 2 }}>Статус</div>
                <span className={`tag ${detail.ended_at ? "tag-neutral" : "tag-iris"}`}>
                  {detail.ended_at ? "Завершена" : "Активна"}
                </span>
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

            {/* Акты */}
            <div style={{ display: "grid", gridTemplateColumns: detail.end_inspection ? "1fr 1fr" : "1fr", gap: 20 }}>
              {detail.start_inspection && (
                <div>
                  <div style={{
                    fontWeight: 700, fontSize: 13, marginBottom: 12,
                    paddingBottom: 8, borderBottom: "2px solid #27ae60",
                    color: "#27ae60",
                  }}>
                    📋 Акт приёмки
                  </div>
                  <InspectionView insp={detail.start_inspection} />
                </div>
              )}
              {detail.end_inspection && (
                <div>
                  <div style={{
                    fontWeight: 700, fontSize: 13, marginBottom: 12,
                    paddingBottom: 8, borderBottom: "2px solid var(--iris)",
                    color: "var(--iris)",
                  }}>
                    🔑 Акт сдачи
                  </div>
                  <InspectionView insp={detail.end_inspection} />
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

function HandoverJournal({ tabsNav }: { tabsNav?: ReactNode }) {
  const { user: me } = useAuth();
  const isStaff = me?.role === "admin" || me?.role === "foreman";

  const [sessions, setSessions] = useState<VehicleSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  // Принудительная сдача
  const [closeId, setCloseId] = useState<number | null>(null);   // session id диалога
  const [closeOdo, setCloseOdo] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const odoRef = useRef<HTMLInputElement | null>(null);

  function loadSessions() {
    setLoading(true);
    api.get<VehicleSessionRow[]>("/api/vehicle-inspections/sessions/")
      .then(setSessions)
      .catch(err => setError(err instanceof ApiError ? err.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadSessions(); }, []);

  async function handleForceClose() {
    if (!closeId) return;
    setClosing(true);
    setCloseError(null);
    try {
      await api.post(`/api/vehicle-inspections/sessions/${closeId}/close`, {
        odometer: closeOdo.trim() ? parseInt(closeOdo, 10) : null,
      });
      setCloseId(null);
      setCloseOdo("");
      loadSessions();
    } catch (err) {
      setCloseError(err instanceof ApiError ? err.message : "Ошибка");
    } finally {
      setClosing(false);
    }
  }

  function fmtDT(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function duration(start: string, end: string | null): string {
    if (!end) return "В пути";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabsNav}
      </div>

      {error && <p className="fcard" style={{ color: "var(--ember)", marginBottom: 16 }}>{error}</p>}

      <div className="fcard">
        {loading ? (
          <p style={{ color: "var(--smoke)" }}>Загрузка...</p>
        ) : sessions.length === 0 ? (
          <p style={{ color: "var(--smoke)" }}>Нет записей. Акты приёмки-сдачи будут отображаться здесь.</p>
        ) : (
          <div className="tbl-scroll">
            <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 10px" }}>
              Нажмите на строку, чтобы открыть полный акт с чеклистом и повреждениями
            </p>
            <table>
              <thead>
                <tr>
                  <th>Водитель</th>
                  <th>Машина</th>
                  <th>Принята</th>
                  <th>Сдана</th>
                  <th>Время смены</th>
                  <th>Пробег (км)</th>
                  <th>Акты</th>
                  <th>Статус</th>
                  {isStaff && <th></th>}
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr
                    key={s.id}
                    onClick={() => setDetailId(s.id)}
                    style={{ cursor: "pointer" }}
                    title="Открыть акт"
                  >
                    <td>{s.driver_name || `Водитель #${s.driver_id}`}</td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{s.truck_plate}</span>
                      {s.truck_label && s.truck_label !== s.truck_plate && (
                        <span style={{ color: "var(--smoke)", fontSize: 12, marginLeft: 6 }}>
                          {s.truck_label}
                        </span>
                      )}
                    </td>
                    <td>{fmtDT(s.started_at)}</td>
                    <td>{fmtDT(s.ended_at)}</td>
                    <td style={{ color: "var(--smoke)", fontSize: 13 }}>
                      {duration(s.started_at, s.ended_at)}
                    </td>
                    <td style={{ fontSize: 13 }}>
                      {s.start_odometer != null ? (
                        <span>
                          {s.start_odometer.toLocaleString("ru-RU")}
                          {s.end_odometer != null && (
                            <span style={{ color: "var(--smoke)" }}>
                              {" → "}{s.end_odometer.toLocaleString("ru-RU")}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span style={{ color: "var(--smoke)" }}>—</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {s.start_inspection_id != null && (
                        <span className="tag tag-neutral" style={{ marginRight: 4 }}>📋 Приёмка</span>
                      )}
                      {s.end_inspection_id != null && (
                        <span className="tag tag-neutral">🔑 Сдача</span>
                      )}
                    </td>
                    <td>
                      <span className={`tag ${s.ended_at ? "tag-neutral" : "tag-iris"}`}>
                        {s.ended_at ? "Завершена" : "Активна"}
                      </span>
                    </td>
                    {isStaff && (
                      <td onClick={(e) => e.stopPropagation()}>
                        {!s.ended_at && (
                          <button
                            className="pill-btn"
                            style={{ fontSize: 12, color: "var(--ember)", whiteSpace: "nowrap" }}
                            onClick={() => { setCloseId(s.id); setCloseOdo(""); setCloseError(null); }}
                          >
                            Сдать
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailId !== null && (
        <SessionDetailModal
          sessionId={detailId}
          onClose={() => setDetailId(null)}
        />
      )}

      {/* Диалог принудительной сдачи */}
      {closeId !== null && (
        <div className="modal-overlay">
          <div className="fcard" style={{ width: 380, maxWidth: "92vw", padding: 0 }}>
            <div style={{
              background: "var(--dark)", color: "#fff", padding: "14px 20px",
              borderRadius: "26px 26px 0 0",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Принудительная сдача</span>
              <button
                type="button"
                onClick={() => setCloseId(null)}
                style={{ background: "none", border: "none", color: "#fff", fontSize: 20, cursor: "pointer" }}
              >×</button>
            </div>
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 0, marginBottom: 16 }}>
                Сессия будет закрыта от имени администратора. Акт сдачи создастся без чеклиста.
              </p>
              <label className="label">Пробег (одометр, км) — необязательно</label>
              <input
                ref={odoRef}
                type="number"
                className="input"
                value={closeOdo}
                onChange={(e) => setCloseOdo(e.target.value)}
                placeholder="Например, 125400"
                style={{ marginBottom: 14 }}
              />
              {closeError && (
                <p style={{ color: "var(--ember)", fontSize: 13, marginBottom: 10 }}>{closeError}</p>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="pill-btn" type="button" onClick={() => setCloseId(null)}>
                  Отмена
                </button>
                <button
                  className="pill-btn solid"
                  type="button"
                  disabled={closing}
                  onClick={handleForceClose}
                  style={{ background: "var(--ember)", borderColor: "var(--ember)" }}
                >
                  {closing ? "Закрываю..." : "Сдать принудительно"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Trips() {
  const [searchParams] = useSearchParams();
  // Параметры из Reports.tsx (drill-down по строке отчёта):
  // from, to — диапазон дат; driver, truck, carrier — фильтры (строковые значения).
  const _spFrom    = searchParams.get("from");
  const _spTo      = searchParams.get("to");
  const _spDriver  = searchParams.get("driver");
  const _spTruck   = searchParams.get("truck");
  const _spCarrier = searchParams.get("carrier");

  const [tab, setTab] = useState<TripsTabId>("registry");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [lastImportMeta, setLastImportMeta] = useState<{ source: string; carrier: string } | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("dep_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // По умолчанию - последний месяц (скользящие 30 дней).
  // Если пришли из Отчётов (drill-down), используем период и фильтры из URL.
  const [dateFrom, setDateFrom] = useState(() => {
    if (_spFrom) return _spFrom;
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return isoDate(d);
  });
  const [dateTo, setDateTo] = useState(() => _spTo || isoDate(new Date()));

  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [driverFilter, setDriverFilter] = useState<Set<string>>(
    () => _spDriver ? new Set([_spDriver]) : new Set()
  );
  const [truckFilter, setTruckFilter] = useState<Set<string>>(
    () => _spTruck ? new Set([_spTruck]) : new Set()
  );
  const [carrierFilter, setCarrierFilter] = useState<Set<string>>(
    () => _spCarrier ? new Set([_spCarrier]) : new Set()
  );

  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState(SOURCES[0].value);
  const [importCarrier, setImportCarrier] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [t, d, tr, c] = await Promise.all([
        api.get<Trip[]>("/api/trips/"),
        api.get<Driver[]>("/api/drivers/"),
        api.get<Truck[]>("/api/trucks/"),
        api.get<Carrier[]>("/api/carriers/"),
      ]);
      setTrips(t);
      setDrivers(d);
      setTrucks(tr);
      setCarriers(c);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  // Перевозчики приходят асинхронно (loadAll), а окно импорта можно открыть
  // до того, как они подгрузятся - держим выбранный перевозчик синхронным с
  // первым в списке реестра, пока пользователь сам не выбрал другого.
  useEffect(() => {
    if (carriers.length > 0 && !importCarrier) {
      setImportCarrier(carriers[0].name);
    }
  }, [carriers, importCarrier]);

  function openImport() {
    setImportCarrier((c) => c || carriers[0]?.name || "");
    setImportOpen(true);
  }

  async function handleDownloadTemplate() {
    setError(null);
    try {
      await api.download("/api/trips/import/template", "shablon_reestr_poezdok.xlsx");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка скачивания шаблона");
    }
  }

  const driverName = (t: Trip) => drivers.find((d) => d.id === t.driver_id)?.name || t.driver_name_raw || "—";
  const truckLabel = (t: Trip) => trucks.find((tr) => tr.id === t.truck_id)?.plate || t.plate_raw || "—";

  // Кнопка "Экспорт" (2026-06-29, "выгрузка файла в эксель с учетом
  // сортировки, добавить колонку 'билинг'") - берёт "sorted" (вся выборка
  // после фильтров+сортировки, не "paged", который урезан текущей
  // страницей), формирует строки в том же виде, что и таблица на экране
  // (driverName/truckLabel/fmtDateTime/billingFor), и шлёт на бэкенд для
  // сборки .xlsx. Бэкенд не пересчитывает фильтры/сортировку/биллинг -
  // только сериализует присланное, поэтому файл всегда совпадает с тем,
  // что видно на экране в момент нажатия.
  async function handleExport() {
    setError(null);
    try {
      const rows = sorted.map((t) => ({
        source: t.source,
        carrier_name: t.carrier_name || "—",
        request_number: t.request_number,
        status: t.status || "—",
        dep_at: fmtDateTime(t.dep_at),
        end_at: fmtDateTime(t.end_at),
        tariff_type: t.tariff_type || "—",
        driver_name: driverName(t),
        truck_label: truckLabel(t),
        driver_phone: t.driver_phone || "—",
        amount: t.amount,
        billing: billingFor(t),
        fines: t.fines || 0,
      }));
      await api.downloadPost("/api/trips/export", { rows }, "reestr_poezdok.xlsx");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка экспорта");
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // toggleSelectAll вызывается из JSX после объявления paged,
  // но currentPage передаётся туда через closure — используем ref-паттерн
  const pagedRef = useRef<Trip[]>([]);

  function toggleSelectAll() {
    const cur = pagedRef.current;
    if (cur.every(t => selectedIds.has(t.id))) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        cur.forEach(t => next.delete(t.id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        cur.forEach(t => next.add(t.id));
        return next;
      });
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    setError(null);
    try {
      await api.post("/api/trips/bulk-delete", { ids: Array.from(selectedIds) });
      setSelectedIds(new Set());
      setDeleteConfirm(false);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка удаления");
    } finally {
      setDeleting(false);
    }
  }

  async function handleImportSubmit() {
    if (!importFile) return;
    setImporting(true);
    setError(null);
    setSummary(null);
    try {
      const result = await api.upload<ImportSummary>("/api/trips/import", importFile, {
        source: importSource,
        carrier_name: importCarrier,
      });
      setSummary(result);
      setLastImportMeta({ source: importSource, carrier: importCarrier });
      setImportOpen(false);
      setImportFile(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка импорта");
    } finally {
      setImporting(false);
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
        style={{ cursor: "pointer", userSelect: "none", color: active ? "var(--iris)" : undefined }}
      >
        {label} {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </th>
    );
  }

  const statusOptions = uniqueSorted(trips.map((t) => t.status || "—"));
  const driverOptions = uniqueSorted(trips.map(driverName));
  const truckOptions = uniqueSorted(trips.map(truckLabel));
  const carrierOptions = uniqueSorted(trips.map((t) => t.carrier_name || "—"));

  const filtered = trips.filter((t) => {
    const day = (t.dep_at || "").slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    if (statusFilter.size > 0 && !statusFilter.has(t.status || "—")) return false;
    if (driverFilter.size > 0 && !driverFilter.has(driverName(t))) return false;
    if (truckFilter.size > 0 && !truckFilter.has(truckLabel(t))) return false;
    if (carrierFilter.size > 0 && !carrierFilter.has(t.carrier_name || "—")) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });

  // "Биллинг по выборке" (2026-06-29, "сумма с учетом ск перевозчика") -
  // сумма по поездке за вычетом "% СК" перевозчика (Carrier.insurance_pct,
  // тот же процент, что в calculations.py::commission_pct_for() вычитается
  // из gross при расчёте net в еженедельном P&L). Сопоставление по
  // Trip.carrier_name, как и на бэкенде; если перевозчик не найден в
  // справочнике - 0% (без вычета), а не settings.default_commission_pct, т.к.
  // /api/settings админ-only и эта страница доступна не только админу.
  const billingFor = (t: Trip) => {
    const carrier = carriers.find((c) => c.name === t.carrier_name);
    const pct = carrier?.insurance_pct || 0;
    return t.amount * (1 - pct / 100);
  };

  const totalAmount = filtered.reduce((sum, t) => sum + t.amount, 0);
  const totalBilling = filtered.reduce((sum, t) => sum + billingFor(t), 0);
  const totalFines = filtered.reduce((sum, t) => sum + (t.fines || 0), 0);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const paged = sorted.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);
  pagedRef.current = paged;

  // 2026-06-29: переключатель вкладок передаётся вниз как tabsNav (как
  // Expenses.tsx -> Fuel), рисуется в одной строке с кнопками действия
  // активной вкладки вместо отдельной строки над контентом.
  const tabsNav = (
    <div className="navpills" style={{ width: "fit-content" }}>
      {TRIPS_TABS.map((t) => (
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
            <Icon name="grid" size={13} /> Автопарк <Icon name="chevr" size={13} /> Логистика
          </div>
          <h1 className="pagetitle">Рейсы</h1>
        </div>
      </div>

      {tab === "mileage" && <Mileage tabsNav={tabsNav} />}
      {tab === "handover" && <HandoverJournal tabsNav={tabsNav} />}

      {tab === "registry" && (
        <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabsNav}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {selectedIds.size > 0 && (
            <>
              <span style={{ fontSize: 13, color: "var(--smoke)" }}>Выбрано: {selectedIds.size}</span>
              {deleteConfirm ? (
                <>
                  <span style={{ fontSize: 13, color: "var(--ember)" }}>Удалить {selectedIds.size} рейс(ов)?</span>
                  <button className="pill-btn" style={{ borderColor: "var(--ember)", color: "var(--ember)" }}
                    onClick={() => setDeleteConfirm(false)}>Отмена</button>
                  <button className="pill-btn solid" style={{ background: "var(--ember)", borderColor: "var(--ember)" }}
                    disabled={deleting} onClick={handleBulkDelete}>
                    {deleting ? "Удаление..." : "Подтвердить"}
                  </button>
                </>
              ) : (
                <button className="pill-btn" style={{ borderColor: "var(--ember)", color: "var(--ember)" }}
                  onClick={() => setDeleteConfirm(true)}>
                  Удалить выбранные
                </button>
              )}
              <button className="pill-btn" onClick={() => { setSelectedIds(new Set()); setDeleteConfirm(false); }}>
                Снять выделение
              </button>
            </>
          )}
          <button className="pill-btn" onClick={handleExport} disabled={sorted.length === 0}>
            <Icon name="download" size={17} /> <span className="lbl-hide">Экспорт</span>
          </button>
          <button className="pill-btn" onClick={handleDownloadTemplate}>
            <Icon name="download" size={17} /> <span className="lbl-hide">Скачать шаблон</span>
          </button>
          <button className="pill-btn solid" onClick={openImport}>
            <Icon name="doc" size={17} /> <span className="lbl-hide">Импортировать реестр (.xlsx)</span>
          </button>
        </div>
      </div>

      {error && (
        <p className="fcard" style={{ color: "var(--ember)", marginBottom: 24 }}>
          {error}
        </p>
      )}

      {summary && (
        <div className="fcard" style={{ marginBottom: 24 }}>
          <p style={{ fontWeight: 500, margin: "0 0 12px" }}>Результат импорта</p>
          {lastImportMeta && (
            <p style={{ fontSize: 13, margin: "0 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
              <SourceTag source={lastImportMeta.source} />
              <span style={{ color: "var(--smoke)" }}>{lastImportMeta.carrier}</span>
            </p>
          )}
          <p style={{ fontSize: 14, color: "var(--smoke)", margin: "0 0 4px" }}>
            Строк в файле: {summary.total_rows} · Новых поездок: {summary.trips_created} · Обновлено: {summary.trips_updated}{" "}
            · Некорректных строк: {summary.skipped_bad_rows}
          </p>
          {summary.new_drivers.length > 0 && (
            <p style={{ fontSize: 13, margin: "8px 0 0" }}>
              Новые водители:{" "}
              {summary.new_drivers.map((n) => (
                <span key={n} className="tag tag-iris" style={{ marginRight: 6 }}>
                  {n}
                </span>
              ))}
            </p>
          )}
          {summary.new_trucks.length > 0 && (
            <p style={{ fontSize: 13, margin: "8px 0 0" }}>
              Новые грузовики:{" "}
              {summary.new_trucks.map((n) => (
                <span key={n} className="tag tag-ember" style={{ marginRight: 6 }}>
                  {n}
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      {importOpen && (
        <div className="modal-overlay">
          <div className="fcard" style={{ width: 420 }}>
            <h2 style={{ fontSize: 18, margin: "0 0 16px" }}>Импорт реестра</h2>

            <label className="label">Источник</label>
            <select
              className="input"
              value={importSource}
              onChange={(e) => setImportSource(e.target.value)}
              style={{ marginBottom: 16 }}
            >
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.value}
                </option>
              ))}
            </select>

            <label className="label">Перевозчик</label>
            {carriers.length > 0 ? (
              <select
                className="input"
                value={importCarrier}
                onChange={(e) => setImportCarrier(e.target.value)}
                style={{ marginBottom: 16 }}
              >
                {carriers.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <p style={{ fontSize: 13, color: "var(--smoke)", margin: "0 0 16px" }}>
                Нет перевозчиков — добавьте в Справочниках → Перевозчики.
              </p>
            )}

            <label className="label">Файл (.xlsx)</label>
            <input
              type="file"
              accept=".xlsx"
              className="input"
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              style={{ marginBottom: 20 }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                className="pill-btn"
                onClick={() => {
                  setImportOpen(false);
                  setImportFile(null);
                }}
              >
                Отмена
              </button>
              <button
                className="pill-btn solid"
                disabled={!importFile || !importCarrier || importing}
                onClick={handleImportSubmit}
              >
                {importing ? "Импорт..." : "Импортировать"}
              </button>
            </div>
          </div>
        </div>
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
            label="Статус"
            options={statusOptions}
            selected={statusFilter}
            onChange={(s) => {
              setStatusFilter(s);
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
            label="Машина"
            options={truckOptions}
            selected={truckFilter}
            onChange={(s) => {
              setTruckFilter(s);
              setPage(1);
            }}
          />
          <MultiSelect
            label="Перевозчик"
            options={carrierOptions}
            selected={carrierFilter}
            onChange={(s) => {
              setCarrierFilter(s);
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
          <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 4px" }}>Поездок в выборке</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{filtered.length}</p>
        </div>
        <div className="fcard" style={{ flex: 1 }}>
          <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 4px" }}>Сумма по выборке</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{money(totalAmount)}</p>
        </div>
        <div className="fcard" style={{ flex: 1 }}>
          <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 4px" }}>Биллинг по выборке</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{money(totalBilling)}</p>
        </div>
        <div className="fcard" style={{ flex: 1 }}>
          <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 4px" }}>Штрафы по выборке</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0, color: totalFines ? "var(--bad-ink)" : undefined }}>
            {money(totalFines)}
          </p>
        </div>
      </div>

      <div className="fcard">
        {loading ? (
          <p style={{ color: "var(--smoke)" }}>Загрузка...</p>
        ) : trips.length === 0 ? (
          <p style={{ color: "var(--smoke)" }}>Пока нет ни одной поездки. Импортируйте реестр, чтобы начать.</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: "var(--smoke)" }}>Нет поездок, соответствующих текущим фильтрам.</p>
        ) : (
          <>
            <div className="tbl-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36, padding: "0 8px" }}>
                      <input type="checkbox"
                        checked={paged.length > 0 && paged.every(t => selectedIds.has(t.id))}
                        onChange={toggleSelectAll}
                        title="Выбрать все на странице"
                      />
                    </th>
                    <Th label="Источник" sortKeyName="source" />
                    <Th label="Перевозчик" sortKeyName="carrier_name" />
                    <Th label="№ заявки" sortKeyName="request_number" />
                    <Th label="Статус" sortKeyName="status" />
                    <Th label="Отгрузка" sortKeyName="dep_at" />
                    <Th label="Окончание" sortKeyName="end_at" />
                    <Th label="Тип" sortKeyName="tariff_type" />
                    <Th label="Водитель" sortKeyName="driver_name_raw" />
                    <Th label="Машина" sortKeyName="plate_raw" />
                    <Th label="Телефон" sortKeyName="driver_phone" />
                    <Th label="Сумма" sortKeyName="amount" />
                    <Th label="Штраф" sortKeyName="fines" />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((t) => (
                    <tr key={t.id} style={selectedIds.has(t.id) ? { background: "var(--iris-pale, rgba(86,131,218,.08))" } : undefined}>
                      <td style={{ width: 36, padding: "0 8px" }}>
                        <input type="checkbox"
                          checked={selectedIds.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                        />
                      </td>
                      <td>
                        <SourceTag source={t.source} />
                      </td>
                      <td>{t.carrier_name || "—"}</td>
                      <td>{t.request_number}</td>
                      <td>
                        <span className={`tag ${t.status === "Отменено" ? "tag-ember" : "tag-iris"}`}>
                          {t.status || "—"}
                        </span>
                      </td>
                      <td>{fmtDateTime(t.dep_at)}</td>
                      <td>{fmtDateTime(t.end_at)}</td>
                      <td>{t.tariff_type || "—"}</td>
                      <td>{driverName(t)}</td>
                      <td>{truckLabel(t)}</td>
                      <td>{t.driver_phone || "—"}</td>
                      <td>{money(t.amount)}</td>
                      <td style={{ color: t.fines ? "var(--bad-ink)" : undefined }}>{money(t.fines)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
              <span style={{ fontSize: 13, color: "var(--smoke)" }}>
                Страница {pageClamped} из {totalPages} ({sorted.length} поездок)
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
        </>
      )}
    </div>
  );
}
