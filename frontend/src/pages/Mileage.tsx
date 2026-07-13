import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import Icon from "../components/Icon";
import MultiSelect from "../components/MultiSelect";
import { fmtDate, isoDate, uniqueSorted } from "../lib/format";

// «Пробеги» (2026-06-29, "нам надо теперь ввести данные по пробегам, нужен
// журнал с формой добавления... дата, пробег в км, машина, водитель (для
// водителей автозаполнение собой) и тумблер - ТО") - вкладка раздела «Рейсы»
// (см. pages/Trips.tsx). Бэкенд под это уже существовал дормантом с
// 2026-06-28 (план "кабинет водителя"): models.MileageLog, /api/mileage-logs,
// calculations.py::maintenance_status() - этой фиче не хватало только поля
// driver_id (добавлено тем же числом) и самого фронта.
type MileageEntry = {
  id: number;
  date: string;
  truck_id: number;
  driver_id: number | null;
  odometer: number | null;
  is_service: boolean;
  note: string;
};

type Truck = { id: number; label: string };
type Driver = { id: number; name: string };

type SortKey = "date" | "truck_label" | "driver_label" | "odometer" | "is_service";

const PAGE_SIZES = [50, 100, 300, 500];

export default function Mileage({ tabsNav }: { tabsNav?: ReactNode } = {}) {
  const { user } = useAuth();
  // own_filter_field="driver_id" на бэкенде (main.py) уже сужает то, что
  // водитель *видит*, до своих записей - поэтому ему не нужен полный список
  // водителей (зона "drivers" для роли "водитель" остаётся закрытой, это не
  // связано с этой фичей); просто показываем его самого по auth-данным.
  const isDriverRole = user?.role === "driver";

  const [entries, setEntries] = useState<MileageEntry[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // В отличие от Реестра поездок/Топлива здесь нет дефолтного окна "последние
  // 30 дней" - записей немного (обычно одна на машину раз в несколько дней),
  // и часто важно сразу видеть последнюю отметку ТО, даже если она была
  // давно. Фильтр по датам всё равно доступен, просто не включён по умолчанию.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [truckFilter, setTruckFilter] = useState<Set<string>>(new Set());
  const [driverFilter, setDriverFilter] = useState<Set<string>>(new Set());
  const [serviceOnly, setServiceOnly] = useState(false);

  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  const [addOpen, setAddOpen] = useState(false);
  const [formDate, setFormDate] = useState(() => isoDate(new Date()));
  const [formTruckId, setFormTruckId] = useState<number | "">("");
  const [formDriverId, setFormDriverId] = useState<number | "">("");
  const [formOdometer, setFormOdometer] = useState("");
  const [formIsService, setFormIsService] = useState(false);
  const [formNote, setFormNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const calls: [Promise<MileageEntry[]>, Promise<Truck[]>, Promise<Driver[]>?] = [
        api.get<MileageEntry[]>("/api/mileage-logs/"),
        api.get<Truck[]>("/api/trucks/"),
      ];
      if (!isDriverRole) calls.push(api.get<Driver[]>("/api/drivers/"));
      const results = await Promise.all(calls);
      setEntries(results[0] as MileageEntry[]);
      setTrucks(results[1] as Truck[]);
      if (results[2]) setDrivers(results[2] as Driver[]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Автозаполнение «собой» для роли «водитель» (по просьбе пользователя
  // 2026-06-29) - поле «Водитель» в форме ниже для этой роли не показывается
  // вообще (только подпись), так что состояние formDriverId здесь не имеет
  // значения - используется user?.driver_id напрямую в handleSubmit.
  function openAdd() {
    setFormDate(isoDate(new Date()));
    setFormTruckId("");
    setFormDriverId("");
    setFormOdometer("");
    setFormIsService(false);
    setFormNote("");
    setAddOpen(true);
  }

  async function handleSubmit() {
    if (!formTruckId || !formOdometer) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/mileage-logs/", {
        date: formDate,
        truck_id: formTruckId,
        driver_id: isDriverRole ? user?.driver_id ?? null : formDriverId || null,
        odometer: Number(formOdometer),
        is_service: formIsService,
        note: formNote,
      });
      setAddOpen(false);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  const truckLabel = (e: MileageEntry) => trucks.find((t) => t.id === e.truck_id)?.label || "—";
  const driverLabel = (e: MileageEntry) => {
    if (isDriverRole) return user?.full_name || "Вы";
    if (!e.driver_id) return "—";
    return drivers.find((d) => d.id === e.driver_id)?.name || "—";
  };

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

  const truckOptions = uniqueSorted(entries.map(truckLabel));
  const driverOptions = uniqueSorted(entries.map(driverLabel));

  const filtered = entries.filter((e) => {
    const day = (e.date || "").slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    if (truckFilter.size > 0 && !truckFilter.has(truckLabel(e))) return false;
    if (!isDriverRole && driverFilter.size > 0 && !driverFilter.has(driverLabel(e))) return false;
    if (serviceOnly && !e.is_service) return false;
    return true;
  });

  function sortValue(e: MileageEntry, key: SortKey): string | number {
    if (key === "truck_label") return truckLabel(e);
    if (key === "driver_label") return driverLabel(e);
    if (key === "is_service") return e.is_service ? 1 : 0;
    if (key === "odometer") return e.odometer ?? 0;
    return e.date;
  }

  const sorted = [...filtered].sort((a, b) => {
    const av = sortValue(a, sortKey);
    const bv = sortValue(b, sortKey);
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });

  const serviceCount = filtered.filter((e) => e.is_service).length;
  const truckCount = new Set(filtered.map((e) => e.truck_id)).size;
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const paged = sorted.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabsNav}
        <button className="pill-btn solid" onClick={openAdd}>
          <Icon name="plus" size={17} /> <span className="lbl-hide">Добавить запись</span>
        </button>
      </div>

      {error && (
        <p className="fcard" style={{ color: "var(--ember)", marginBottom: 24 }}>
          {error}
        </p>
      )}

      {addOpen && (
        <div className="modal-overlay">
          <div className="fcard" style={{ width: 420 }}>
            <h2 style={{ fontSize: 18, margin: "0 0 16px" }}>Новая запись о пробеге</h2>

            <label className="label">Дата</label>
            <input
              type="date"
              className="input"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              style={{ marginBottom: 16 }}
            />

            <label className="label">Машина</label>
            <select
              className="input"
              value={formTruckId}
              onChange={(e) => setFormTruckId(e.target.value ? Number(e.target.value) : "")}
              style={{ marginBottom: 16 }}
            >
              <option value="">Выберите машину</option>
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>

            <label className="label">Водитель</label>
            {isDriverRole ? (
              <p style={{ margin: "0 0 16px", fontSize: 14 }}>{user?.full_name || "Вы"}</p>
            ) : (
              <select
                className="input"
                value={formDriverId}
                onChange={(e) => setFormDriverId(e.target.value ? Number(e.target.value) : "")}
                style={{ marginBottom: 16 }}
              >
                <option value="">Не указан</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}

            <label className="label">Пробег, км</label>
            <input
              type="number"
              className="input"
              value={formOdometer}
              onChange={(e) => setFormOdometer(e.target.value)}
              style={{ marginBottom: 16 }}
            />

            <label className="checkbox-row" style={{ marginBottom: 4 }}>
              <input type="checkbox" checked={formIsService} onChange={(e) => setFormIsService(e.target.checked)} />
              ТО
            </label>
            <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 16px" }}>
              Отмечает этот пробег и дату как точку прохождения техобслуживания для выбранной машины.
            </p>

            <label className="label">Примечание</label>
            <textarea
              className="input"
              rows={3}
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              style={{ marginBottom: 20, resize: "vertical" }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="pill-btn" onClick={() => setAddOpen(false)}>
                Отмена
              </button>
              <button className="pill-btn solid" disabled={!formTruckId || !formOdometer || saving} onClick={handleSubmit}>
                {saving ? "Сохранение..." : "Сохранить"}
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
            label="Машина"
            options={truckOptions}
            selected={truckFilter}
            onChange={(s) => {
              setTruckFilter(s);
              setPage(1);
            }}
          />
          {!isDriverRole && (
            <MultiSelect
              label="Водитель"
              options={driverOptions}
              selected={driverFilter}
              onChange={(s) => {
                setDriverFilter(s);
                setPage(1);
              }}
            />
          )}
          <div style={{ flexShrink: 0 }}>
            <div className="label" style={{ visibility: "hidden" }}>·</div>
            <button
              type="button"
              onClick={() => { setServiceOnly(!serviceOnly); setPage(1); }}
              style={{
                height: 46,
                padding: "0 18px",
                borderRadius: 999,
                border: serviceOnly ? "none" : "1.5px solid var(--edge)",
                background: serviceOnly ? "var(--iris)" : "transparent",
                color: serviceOnly ? "#fff" : "var(--ink)",
                fontFamily: "inherit",
                fontWeight: 600,
                fontSize: "0.9rem",
                cursor: "pointer",
                transition: "all .15s ease",
                whiteSpace: "nowrap",
              }}
            >
              Только ТО
            </button>
          </div>
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
          <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 4px" }}>Записей в выборке</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{filtered.length}</p>
        </div>
        <div className="fcard" style={{ flex: 1 }}>
          <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 4px" }}>Из них отметка ТО</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{serviceCount}</p>
        </div>
        <div className="fcard" style={{ flex: 1 }}>
          <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 4px" }}>Машин в выборке</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{truckCount}</p>
        </div>
      </div>

      <div className="fcard">
        {loading ? (
          <p style={{ color: "var(--smoke)" }}>Загрузка...</p>
        ) : entries.length === 0 ? (
          <p style={{ color: "var(--smoke)" }}>Пока нет ни одной записи о пробеге. Добавьте первую запись.</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: "var(--smoke)" }}>Нет записей, соответствующих текущим фильтрам.</p>
        ) : (
          <>
            <div className="tbl-scroll">
              <table>
                <thead>
                  <tr>
                    <Th label="Дата" sortKeyName="date" />
                    <Th label="Машина" sortKeyName="truck_label" />
                    <Th label="Водитель" sortKeyName="driver_label" />
                    <Th label="Пробег, км" sortKeyName="odometer" />
                    <Th label="ТО" sortKeyName="is_service" />
                    <th>Примечание</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((e) => (
                    <tr key={e.id}>
                      <td>{fmtDate(e.date)}</td>
                      <td>{truckLabel(e)}</td>
                      <td>{driverLabel(e)}</td>
                      <td>{e.odometer != null ? e.odometer.toLocaleString("ru-RU") : "—"}</td>
                      <td>{e.is_service ? <span className="tag tag-iris">ТО</span> : "—"}</td>
                      <td style={{ color: "var(--smoke)" }}>{e.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
              <span style={{ fontSize: 13, color: "var(--smoke)" }}>
                Страница {pageClamped} из {totalPages} ({sorted.length} записей)
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
    </div>
  );
}
