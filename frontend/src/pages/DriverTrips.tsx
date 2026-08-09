import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { isoDate, money } from "../lib/format";

type TripRow = {
  id: number;
  source: string;
  request_number: string;
  status: string;
  dep_at: string;
  end_at: string | null;
  rate_type: string;
  driver_payout: number;
  fines: number;
};

// ── Форматирование дат ────────────────────────────────────────────────────────
function fmtDt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

// ── Плашка источника ──────────────────────────────────────────────────────────
function SourceBadge({ source }: { source: string }) {
  return (
    <span style={{
      background: "var(--surface-2)", color: "var(--ink)",
      fontSize: 11, fontWeight: 700, letterSpacing: "0.03em",
      padding: "3px 8px", borderRadius: "var(--r-xs)",
      fontFamily: "var(--font-mono)", flexShrink: 0,
      border: "1px solid var(--line-strong)",
    }}>
      {source || "—"}
    </span>
  );
}

// ── Круг типа тарифа ─────────────────────────────────────────────────────────
const RATE_LABEL: Record<string, string> = {
  percentOfNet: "%",
  perTrip:      "Р",
  perKm:        "км",
  salary:       "окл",
  fallback:     "%",
};
function RateCircle({ rateType }: { rateType: string }) {
  return (
    <span style={{
      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
      background: "var(--accent)", color: "var(--on-accent)",
      display: "grid", placeItems: "center",
      fontSize: 11, fontWeight: 700, fontFamily: "var(--font-mono)",
    }}>
      {RATE_LABEL[rateType] ?? "%"}
    </span>
  );
}

// ── Плашка статуса ────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  if (!status) return null;
  const cancelled = (status || "").toLowerCase().startsWith("отмен");
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
      padding: "3px 9px", borderRadius: "var(--r-xs)",
      background: cancelled ? "var(--danger-bg)" : "var(--success-bg)",
      color: cancelled ? "var(--danger)" : "var(--success)",
      fontFamily: "var(--font-ui)",
    }}>
      {status}
    </span>
  );
}

export default function DriverTrips() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const defaultFrom = searchParams.get("from")
    ?? isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const defaultTo = searchParams.get("to") ?? isoDate(new Date());
  const filterParam = searchParams.get("filter") ?? "all";

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo]     = useState(defaultTo);
  const [allRows, setAllRows]   = useState<TripRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const isCancelled = filterParam === "cancelled";

  const rows = allRows.filter(r => {
    const cancelled = (r.status || "").toLowerCase().startsWith("отмен");
    if (filterParam === "completed") return !cancelled;
    if (filterParam === "cancelled") return cancelled;
    return true;
  });

  async function load(from: string, to: string) {
    setLoading(true); setError(null);
    try {
      setAllRows(await api.get<TripRow[]>(
        `/api/driver-dashboard/trips?date_from=${from}&date_to=${to}`
      ));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(dateFrom, dateTo); }, []);

  const totalPayout = rows.reduce((s, r) => s + r.driver_payout, 0);
  const totalFines  = rows.reduce((s, r) => s + (r.fines ?? 0), 0);
  const cnt = rows.length;
  const cntLabel = cnt === 1 ? "рейс" : cnt >= 2 && cnt <= 4 ? "рейса" : "рейсов";

  const title = isCancelled ? "Отменённые рейсы"
    : filterParam === "completed" ? "Выполненные рейсы"
    : "Мои рейсы";

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

      {/* ── Шапка ── */}
      <div style={{
        padding: `max(env(safe-area-inset-top, 0px), 16px) 16px 14px`,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: "var(--invert)", border: "none", color: "var(--on-invert)",
            borderRadius: "var(--r-md)", width: 36, height: 36,
            display: "grid", placeItems: "center",
            cursor: "pointer", fontSize: 16, flexShrink: 0,
          }}
        >
          ←
        </button>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, flex: 1, color: "var(--ink)" }}>
          {title}
        </h1>
      </div>

      {/* ── Фильтр дат ── */}
      <div style={{
        background: "var(--surface)",
        borderRadius: "var(--r-xl)",
        margin: "0 16px 10px",
        padding: "10px 12px",
        display: "flex", gap: 6, alignItems: "center",
        border: "1px solid var(--line)",
        overflow: "hidden",
      }}>
        <input
          type="date" value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          style={{
            flex: "1 1 0", minWidth: 0, width: 0,
            padding: "7px 8px", borderRadius: "var(--r-md)",
            border: "1px solid var(--line-strong)",
            background: "var(--surface-2)", color: "var(--ink)",
            fontSize: 12, fontFamily: "var(--font-mono)", outline: "none",
            boxSizing: "border-box",
          }}
        />
        <span style={{ color: "var(--text-3)", fontSize: 13, flexShrink: 0 }}>—</span>
        <input
          type="date" value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          style={{
            flex: "1 1 0", minWidth: 0, width: 0,
            padding: "7px 8px", borderRadius: "var(--r-md)",
            border: "1px solid var(--line-strong)",
            background: "var(--surface-2)", color: "var(--ink)",
            fontSize: 12, fontFamily: "var(--font-mono)", outline: "none",
            boxSizing: "border-box",
          }}
        />
        <button
          onClick={() => load(dateFrom, dateTo)}
          style={{
            background: "var(--accent)", border: "none", color: "var(--on-accent)",
            borderRadius: "var(--r-md)", padding: "7px 14px",
            fontSize: 13, fontWeight: 700, lineHeight: 1,
            cursor: "pointer", flexShrink: 0,
            fontFamily: "var(--font-ui)",
          }}
        >
          ОК
        </button>
      </div>

      {/* ── Итого ── */}
      {!loading && cnt > 0 && (
        <div style={{
          padding: "2px 16px 10px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: 12, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
            {cnt} {cntLabel}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {!isCancelled && (
              <span style={{ fontSize: 13, color: "var(--text-2)" }}>
                Итого{" "}
                <span style={{ fontWeight: 700, color: "var(--ink)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
                  {money(totalPayout)}
                </span>
              </span>
            )}
            {totalFines > 0 && (
              <span style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                −{money(totalFines)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Список ── */}
      <div style={{ flex: 1, padding: "0 16px 48px", display: "flex", flexDirection: "column", gap: 10 }}>

        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-3)", fontSize: 14 }}>
            Загрузка…
          </div>
        )}
        {!loading && error && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--danger)", fontSize: 14 }}>
            {error}
          </div>
        )}
        {!loading && !error && cnt === 0 && (
          <div style={{ textAlign: "center", padding: "80px 0", color: "var(--text-3)", fontSize: 14 }}>
            Рейсов за выбранный период не найдено
          </div>
        )}

        {!loading && !error && rows.map(row => (
          <div key={row.id} style={{
            background: "var(--surface)",
            borderRadius: "var(--r-xl)",
            border: "1px solid var(--line)",
            padding: "14px 16px 12px",
          }}>
            {/* Строка 1: источник + номер + статус */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                background: "var(--success)", display: "inline-block",
              }} />
              <SourceBadge source={row.source} />
              <span style={{
                fontWeight: 700, fontSize: 15, flex: 1, color: "var(--ink)",
                fontFamily: "var(--font-mono)", letterSpacing: "0.01em",
              }}>
                № {row.request_number || "—"}
              </span>
              <StatusBadge status={row.status} />
            </div>

            {/* Строка 2-3: даты + тариф-круг + сумма */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {/* Даты */}
              <div style={{ flex: 1, fontSize: 12, lineHeight: 1.8 }}>
                <div>
                  <span style={{ color: "var(--text-3)", marginRight: 6 }}>Отгрузка</span>
                  <span style={{ color: "var(--ink)", fontWeight: 500, fontFamily: "var(--font-mono)" }}>
                    {fmtDt(row.dep_at)}
                  </span>
                </div>
                {row.end_at && (
                  <div>
                    <span style={{ color: "var(--text-3)", marginRight: 6 }}>Окончание</span>
                    <span style={{ color: "var(--ink)", fontWeight: 500, fontFamily: "var(--font-mono)" }}>
                      {fmtDt(row.end_at)}
                    </span>
                  </div>
                )}
              </div>
              {/* Тариф + сумма */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <RateCircle rateType={row.rate_type} />
                <span style={{
                  fontWeight: 700, fontSize: 16, color: "var(--ink)",
                  fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
                }}>
                  {money(row.driver_payout)}
                </span>
              </div>
            </div>

            {/* Штраф (если есть) */}
            {(row.fines ?? 0) > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--danger)", fontWeight: 600, fontFamily: "var(--font-mono)" }}>
                Штраф −{money(row.fines)}
              </div>
            )}

          </div>
        ))}
      </div>
    </div>
  );
}
