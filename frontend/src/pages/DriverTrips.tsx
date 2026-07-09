/**
 * Реестр рейсов водителя — редизайн 2026-07-01 (светлый стиль).
 */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { isoDate, money } from "../lib/format";

// ---------- Типы ----------
type TripRow = {
  id: number;
  source: string;
  request_number: string;
  status: string;
  dep_at: string;
  end_at: string | null;
  rate_type: string;
  driver_payout: number;
};

// ---------- Стиль (те же константы, что в DriverDashboard) ----------
const C = {
  bg:         "#f0f1f5",
  card:       "#ffffff",
  cardShadow: "0 2px 12px rgba(0,0,0,.07)",
  border:     "#e8e9ee",
  ink:        "#111111",
  ink2:       "#6b6e7a",
  iris:       "var(--iris, #5683da)",
  dark:       "#1a1a1e",
  radius:     16,
};

// ---------- Плашка источника ----------
const SOURCE_CLASS: Record<string, string> = {
  OZON: "tag-iris",
  WB:   "tag-wb",
  ATI:  "tag-ati",
};
function SourceBadge({ source }: { source: string }) {
  const cls = SOURCE_CLASS[source] ?? "tag-neutral";
  return <span className={`tag ${cls}`}>{source || "—"}</span>;
}

// ---------- Плашка типа расчёта ----------
const RATE_CFG: Record<string, { label: string; bg: string; color: string }> = {
  percentOfNet: { label: "%",    bg: "rgba(86,131,218,.12)",  color: "var(--iris, #5683da)" },
  perTrip:      { label: "Рейс", bg: "rgba(39,174,96,.12)",   color: "#27ae60" },
  perKm:        { label: "Км",   bg: "rgba(230,126,34,.12)",  color: "#e67e22" },
  salary:       { label: "Окл",  bg: "rgba(107,110,122,.12)", color: "#6b6e7a" },
};
function RateBadge({ rateType }: { rateType: string }) {
  const cfg = RATE_CFG[rateType] ?? { label: "~%", bg: "rgba(107,110,122,.12)", color: "#6b6e7a" };
  return (
    <span style={{
      background: cfg.bg, color: cfg.color,
      fontSize: 11, fontWeight: 700,
      padding: "3px 8px", borderRadius: 6,
      whiteSpace: "nowrap",
    }}>
      {cfg.label}
    </span>
  );
}

// ---------- Статус рейса ----------
function StatusBadge({ status }: { status: string }) {
  if (!status) return null;
  const cancelled = status === "Отменено";
  return (
    <span style={{
      fontSize: 11, fontWeight: 600,
      padding: "2px 8px", borderRadius: 6,
      background: cancelled ? "rgba(231,76,60,.12)" : "rgba(86,131,218,.12)",
      color: cancelled ? "#e74c3c" : "var(--iris, #5683da)",
      whiteSpace: "nowrap",
      flexShrink: 0,
    }}>
      {status}
    </span>
  );
}

// ---------- Форматирование дат ----------
function fmtDt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" })
    + " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

// ---------- Компонент ----------
export default function DriverTrips() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const defaultFrom = searchParams.get("from")
    ?? isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const defaultTo = searchParams.get("to") ?? isoDate(new Date());

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo]     = useState(defaultTo);
  const [rows, setRows]         = useState<TripRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function load(from: string, to: string) {
    setLoading(true); setError(null);
    try {
      setRows(await api.get<TripRow[]>(
        `/api/driver-dashboard/trips?date_from=${from}&date_to=${to}`
      ));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(dateFrom, dateTo); }, []);

  const totalPayout = rows.reduce((s, r) => s + r.driver_payout, 0);
  const cnt = rows.length;
  const cntLabel = cnt === 1 ? "рейс" : cnt < 5 ? "рейса" : "рейсов";

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

      {/* ══════════ ШАПКА ══════════ */}
      <div style={{
        background: C.card,
        borderBottom: `1px solid ${C.border}`,
        padding: `max(env(safe-area-inset-top, 0px), 14px) 16px 14px`,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: C.dark, border: "none", color: "#fff",
            borderRadius: 10, width: 36, height: 36,
            display: "grid", placeItems: "center",
            cursor: "pointer", fontSize: 18, flexShrink: 0,
          }}
        >
          ←
        </button>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, flex: 1 }}>Мои рейсы</h1>
      </div>

      {/* ══════════ ФИЛЬТР ДАТ ══════════ */}
      <div style={{
        background: C.card,
        borderBottom: `1px solid ${C.border}`,
        padding: "12px 16px",
        display: "flex", gap: 8, alignItems: "center",
      }}>
        <input
          type="date" value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          style={{
            flex: 1, padding: "9px 10px", borderRadius: 10,
            border: `1px solid ${C.border}`,
            background: C.bg, color: C.ink,
            fontSize: 13, fontFamily: "inherit",
          }}
        />
        <span style={{ color: C.ink2, fontSize: 13 }}>—</span>
        <input
          type="date" value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          style={{
            flex: 1, padding: "9px 10px", borderRadius: 10,
            border: `1px solid ${C.border}`,
            background: C.bg, color: C.ink,
            fontSize: 13, fontFamily: "inherit",
          }}
        />
        <button
          onClick={() => load(dateFrom, dateTo)}
          style={{
            background: C.dark, border: "none", color: "#fff",
            borderRadius: 10, padding: "9px 16px",
            fontSize: 13, fontWeight: 600,
            cursor: "pointer", flexShrink: 0,
            fontFamily: "inherit",
          }}
        >
          OK
        </button>
      </div>

      {/* ══════════ ИТОГО ══════════ */}
      {!loading && cnt > 0 && (
        <div style={{
          background: C.card,
          borderBottom: `1px solid ${C.border}`,
          padding: "10px 16px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: 13, color: C.ink2 }}>{cnt} {cntLabel}</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Итого: {money(totalPayout)}</span>
        </div>
      )}

      {/* ══════════ СПИСОК ══════════ */}
      <div style={{ flex: 1, padding: "12px 12px 40px" }}>

        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.ink2, fontSize: 14 }}>
            Загрузка...
          </div>
        )}

        {!loading && error && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#e74c3c", fontSize: 14 }}>
            {error}
          </div>
        )}

        {!loading && !error && cnt === 0 && (
          <div style={{ textAlign: "center", padding: "80px 0", color: C.ink2 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 18,
              background: C.card, boxShadow: C.cardShadow,
              display: "grid", placeItems: "center",
              margin: "0 auto 16px",
            }}>
              <span style={{
                fontFamily: "'icon-works', sans-serif",
                fontSize: 32, color: C.ink2, lineHeight: 1,
              }}
                dangerouslySetInnerHTML={{ __html: "&#66;" }}
              />
            </div>
            <div style={{ fontSize: 14 }}>Рейсов за выбранный период не найдено</div>
          </div>
        )}

        {!loading && !error && rows.map(row => (
          <div key={row.id} style={{
            background: C.card,
            borderRadius: C.radius,
            boxShadow: C.cardShadow,
            padding: "14px 16px 12px",
            marginBottom: 10,
          }}>
            {/* Строка 1: источник + номер + статус */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <SourceBadge source={row.source} />
              <span style={{ fontWeight: 600, fontSize: 14, flex: 1, color: C.ink }}>
                № {row.request_number || "—"}
              </span>
              <StatusBadge status={row.status} />
            </div>

            {/* Разделитель */}
            <div style={{ height: 1, background: C.border, marginBottom: 10 }} />

            {/* Строка 2: даты + расчёт + сумма */}
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 12, color: C.ink2, lineHeight: 1.7 }}>
                <div>
                  <span style={{ color: C.ink2, marginRight: 4 }}>Отгрузка</span>
                  <span style={{ color: C.ink, fontWeight: 500 }}>{fmtDt(row.dep_at)}</span>
                </div>
                {row.end_at && (
                  <div>
                    <span style={{ color: C.ink2, marginRight: 4 }}>Окончание</span>
                    <span style={{ color: C.ink, fontWeight: 500 }}>{fmtDt(row.end_at)}</span>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <RateBadge rateType={row.rate_type} />
                <span style={{ fontWeight: 700, fontSize: 16, color: C.ink }}>
                  {money(row.driver_payout)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
