import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api, ApiError } from "../api";

type TripBatch = {
  id: number;
  period_start: string;
  period_end: string;
  driver_id: number;
  truck_id: number;
  trips_count: number;
  gross_revenue: number;
  rate_per_trip: number;
  route_name: string;
};

type Driver = { id: number; name: string };
type Truck = { id: number; label: string };

type ImportSummary = {
  total_rows: number;
  batches_created: number;
  skipped_cancelled: number;
  skipped_bad_rows: number;
  new_drivers: string[];
  new_trucks: string[];
};

const money = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽";
const fmtDate = (d: string) => new Date(d).toLocaleDateString("ru-RU");

export default function TripBatches() {
  const [batches, setBatches] = useState<TripBatch[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [b, d, t] = await Promise.all([
        api.get<TripBatch[]>("/api/trip-batches/"),
        api.get<Driver[]>("/api/drivers/"),
        api.get<Truck[]>("/api/trucks/"),
      ]);
      setBatches(b.sort((x, y) => (x.period_start < y.period_start ? 1 : -1)));
      setDrivers(d);
      setTrucks(t);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const driverName = (id: number) => drivers.find((d) => d.id === id)?.name || `#${id}`;
  const truckLabel = (id: number) => trucks.find((t) => t.id === id)?.label || `#${id}`;

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    setSummary(null);
    try {
      const result = await api.upload<ImportSummary>("/api/trip-batches/import", file);
      setSummary(result);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка импорта");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Реестр поездок</h1>
        <div>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <button className="btn btn-primary" disabled={importing} onClick={() => fileInput.current?.click()}>
            {importing ? "Импорт..." : "Импортировать реестр (.xlsx)"}
          </button>
        </div>
      </div>

      {error && (
        <p className="card" style={{ color: "var(--ember)", marginBottom: 24 }}>
          {error}
        </p>
      )}

      {summary && (
        <div className="card" style={{ marginBottom: 24 }}>
          <p style={{ fontWeight: 500, margin: "0 0 12px" }}>Результат импорта</p>
          <p style={{ fontSize: 14, color: "var(--smoke)", margin: "0 0 4px" }}>
            Строк в файле: {summary.total_rows} · Создано рейсов: {summary.batches_created} · Отменённых пропущено:{" "}
            {summary.skipped_cancelled} · Некорректных строк: {summary.skipped_bad_rows}
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

      <div className="card">
        {loading ? (
          <p style={{ color: "var(--smoke)" }}>Загрузка...</p>
        ) : batches.length === 0 ? (
          <p style={{ color: "var(--smoke)" }}>Пока нет ни одного рейса. Импортируйте реестр, чтобы начать.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Период</th>
                <th>Водитель</th>
                <th>Грузовик</th>
                <th>Тип</th>
                <th>Рейсов</th>
                <th>Ставка/рейс</th>
                <th>Выручка</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>
                    {fmtDate(b.period_start)} – {fmtDate(b.period_end)}
                  </td>
                  <td>{driverName(b.driver_id)}</td>
                  <td>{truckLabel(b.truck_id)}</td>
                  <td>{b.route_name || "—"}</td>
                  <td>{b.trips_count}</td>
                  <td>{money(b.rate_per_trip)}</td>
                  <td>{money(b.gross_revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
