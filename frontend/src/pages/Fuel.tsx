import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import Icon from "../components/Icon";
import MultiSelect from "../components/MultiSelect";
import { fmtDateTime, isoDate, money, uniqueSorted } from "../lib/format";

type FuelRecord = {
  id: number;
  external_id: string;
  date: string;
  station: string;
  card_number: string;
  truck_brand_raw: string;
  plate_raw: string;
  truck_id: number | null;
  volume: number;
  amount: number;
  external_transaction_id: string;
};

type Truck = { id: number; label: string; plate?: string };

type ImportSummary = {
  total_rows: number;
  records_created: number;
  records_updated: number;
  skipped_bad_rows: number;
  new_trucks: string[];
};

// Ответ POST /api/fuel/post-to-expenses (задача #137, 2026-06-28) - см.
// routers/fuel.py::post_fuel_to_expenses. Кнопка "Провести в расходы" ниже.
type PostToExpensesSummary = {
  created: number;
  updated: number;
  weeks: number;
  skipped_no_truck: number;
};

// "Машина"/"АЗС" sort by the column's DISPLAYED value, not the raw stored
// field - clicking those headers used to sort by `plate_raw`/`station`
// directly, which often diverges from what's actually shown (truckLabel()
// resolves the truck's current plate (гос. номер, switched from brand
// label 2026-06-25) via truck_id, falling back to
// plate_raw only if truck_id is unset; stationLabel() substitutes "Вручную"/
// "—" for blank station). With imported rows that mismatch made the column
// look unsorted after a click (reported 2026-06-23). The other columns sort
// by their own raw field directly since what's stored there is exactly
// what's displayed.
type SortKey = keyof FuelRecord | "truck_label" | "station_label";

const PAGE_SIZES = [50, 100, 300, 500];

export default function Fuel({ tabsNav }: { tabsNav?: ReactNode } = {}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [records, setRecords] = useState<FuelRecord[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const [posting, setPosting] = useState(false);
  const [postSummary, setPostSummary] = useState<PostToExpensesSummary | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // По умолчанию - последний месяц (скользящие 30 дней), как в реестре поездок.
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return isoDate(d);
  });
  const [dateTo, setDateTo] = useState(() => isoDate(new Date()));

  const [truckFilter, setTruckFilter] = useState<Set<string>>(new Set());
  const [stationFilter, setStationFilter] = useState<Set<string>>(new Set());

  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  // Bulk selection (admin only)
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const checkAllRef = useRef<HTMLInputElement>(null);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualDate, setManualDate] = useState(() => isoDate(new Date()));
  const [manualTruckId, setManualTruckId] = useState<number | "">("");
  const [manualVolume, setManualVolume] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualStation, setManualStation] = useState("");
  const [manualSaving, setManualSaving] = useState(false);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [f, tr] = await Promise.all([
        api.get<FuelRecord[]>("/api/fuel/"),
        api.get<Truck[]>("/api/trucks/"),
      ]);
      setRecords(f);
      setTrucks(tr);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const truckLabel = (r: FuelRecord) => trucks.find((t) => t.id === r.truck_id)?.plate || r.plate_raw || "—";
  const stationLabel = (r: FuelRecord) => r.station || (r.external_id ? "—" : "Вручную");

  async function handleImportFile(file: File) {
    setImporting(true);
    setError(null);
    setSummary(null);
    try {
      const result = await api.upload<ImportSummary>("/api/fuel/import", file);
      setSummary(result);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка импорта");
    } finally {
      setImporting(false);
    }
  }

  // Перенос топлива в «Реестр расходов» по неделям (задача #137, 2026-06-28) -
  // по кнопке, не автоматически (пользователь выбрал этот вариант явно). Не
  // перезагружает records/trucks - результат живёт в "Реестре расходов"
  // (страница «Расходы»), эта страница его не показывает.
  async function handlePostToExpenses() {
    setPosting(true);
    setError(null);
    try {
      const result = await api.post<PostToExpensesSummary>("/api/fuel/post-to-expenses");
      setPostSummary(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка переноса в расходы");
    } finally {
      setPosting(false);
    }
  }

  function resetManualForm() {
    setManualDate(isoDate(new Date()));
    setManualTruckId("");
    setManualVolume("");
    setManualAmount("");
    setManualStation("");
  }

  async function handleManualSubmit() {
    if (!manualTruckId || !manualVolume || !manualAmount) return;
    setManualSaving(true);
    setError(null);
    try {
      const truck = trucks.find((t) => t.id === manualTruckId);
      await api.post("/api/fuel/", {
        external_id: "",
        date: `${manualDate}T00:00:00`,
        station: manualStation,
        card_number: "",
        truck_brand_raw: "",
        plate_raw: truck?.plate || "",
        truck_id: manualTruckId,
        volume: Number(manualVolume),
        amount: Number(manualAmount),
        external_transaction_id: "",
      });
      setManualOpen(false);
      resetManualForm();
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally {
      setManualSaving(false);
    }
  }

  // Синхронизируем indeterminate-состояние чекбокса «выбрать всё на странице»
  useEffect(() => {
    if (!checkAllRef.current || !isAdmin) return;
    const pageIds = paged.map((r) => r.id);
    const allSel = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
    const someSel = pageIds.some((id) => selected.has(id));
    checkAllRef.current.checked = allSel;
    checkAllRef.current.indeterminate = someSel && !allSel;
  });

  function toggleRow(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function togglePage(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      paged.forEach((r) => (checked ? next.add(r.id) : next.delete(r.id)));
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(filtered.map((r) => r.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function handleBulkDelete() {
    setBulkDeleting(true);
    setError(null);
    try {
      await Promise.all([...selected].map((id) => api.delete(`/api/fuel/${id}`)));
      setSelected(new Set());
      setShowDeleteConfirm(false);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка удаления");
    } finally {
      setBulkDeleting(false);
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

  const truckOptions = uniqueSorted(records.map(truckLabel));
  const stationOptions = uniqueSorted(records.map(stationLabel));

  const filtered = records.filter((r) => {
    const day = (r.date || "").slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    if (truckFilter.size > 0 && !truckFilter.has(truckLabel(r))) return false;
    if (stationFilter.size > 0 && !stationFilter.has(stationLabel(r))) return false;
    return true;
  });

  function sortValue(r: FuelRecord, key: SortKey): string | number | null {
    if (key === "truck_label") return truckLabel(r);
    if (key === "station_label") return stationLabel(r);
    return r[key];
  }

  const sorted = [...filtered].sort((a, b) => {
    const av = sortValue(a, sortKey);
    const bv = sortValue(b, sortKey);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalVolume = filtered.reduce((sum, r) => sum + r.volume, 0);
  const totalAmount = filtered.reduce((sum, r) => sum + r.amount, 0);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageClamped = Math.min(page, totalPages);
  const paged = sorted.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);

  return (
    <div>
      {/* 2026-06-28: собственный pagehead убран - страница теперь живёт как
          вкладка «Топливо» внутри Расходов (см. pages/Expenses.tsx),
          которая передаёт сюда переключатель вкладок (tabsNav) - рисуем его
          в одной строке с кнопками действий, не отдельной строкой. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabsNav}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="pill-btn" onClick={() => setManualOpen(true)}>
            <Icon name="plus" size={17} /> <span className="lbl-hide">Добавить запись</span>
          </button>
          <button className="pill-btn" disabled={posting} onClick={handlePostToExpenses} title="Сформировать недельные итоги по машинам и добавить их в «Реестр расходов»">
            <Icon name="arrowup" size={17} /> <span className="lbl-hide">{posting ? "Переносим..." : "Провести в расходы"}</span>
          </button>
          <label className="pill-btn solid" style={{ cursor: "pointer" }}>
            <Icon name="fuel" size={17} />{" "}
            <span className="lbl-hide">{importing ? "Импорт..." : "Импортировать (.xlsx)"}</span>
            <input
              type="file"
              accept=".xlsx"
              style={{ display: "none" }}
              disabled={importing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) handleImportFile(file);
              }}
            />
          </label>
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
          <p style={{ fontSize: 14, color: "var(--smoke)", margin: "0 0 4px" }}>
            Строк в файле: {summary.total_rows} · Новых записей: {summary.records_created} · Обновлено:{" "}
            {summary.records_updated} · Некорректных строк: {summary.skipped_bad_rows}
          </p>
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

      {postSummary && (
        <div className="fcard" style={{ marginBottom: 24 }}>
          <p style={{ fontWeight: 500, margin: "0 0 12px" }}>Результат переноса в расходы</p>
          <p style={{ fontSize: 14, color: "var(--smoke)", margin: 0 }}>
            Недель обработано: {postSummary.weeks} · Новых строк в реестре расходов: {postSummary.created} ·
            Обновлено: {postSummary.updated}
            {postSummary.skipped_no_truck > 0 && (
              <> · Пропущено без машины: {postSummary.skipped_no_truck}</>
            )}
          </p>
        </div>
      )}

      {/* Подтверждение массового удаления */}
      {showDeleteConfirm && (
        <div className="modal-overlay">
          <div className="fcard" style={{ width: 380 }}>
            <h2 style={{ fontSize: 18, margin: "0 0 12px", color: "var(--ember)" }}>Удалить записи?</h2>
            <p style={{ fontSize: 14, color: "var(--ink-2)", margin: "0 0 20px" }}>
              Будет безвозвратно удалено <strong>{selected.size}</strong> записей о топливе.
              Связанные строки в «Реестре расходов» (если топливо было проведено) — не удаляются.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="pill-btn" onClick={() => setShowDeleteConfirm(false)} disabled={bulkDeleting}>
                Отмена
              </button>
              <button
                className="pill-btn"
                style={{ background: "var(--ember)", color: "#fff", borderColor: "var(--ember)" }}
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? "Удаляем..." : `Удалить ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {manualOpen && (
        <div className="modal-overlay">
          <div className="fcard" style={{ width: 420 }}>
            <h2 style={{ fontSize: 18, margin: "0 0 16px" }}>Новая запись о топливе</h2>

            <label className="label">Дата</label>
            <input
              type="date"
              className="input"
              value={manualDate}
              onChange={(e) => setManualDate(e.target.value)}
              style={{ marginBottom: 16 }}
            />

            <label className="label">Машина</label>
            <select
              className="input"
              value={manualTruckId}
              onChange={(e) => setManualTruckId(e.target.value ? Number(e.target.value) : "")}
              style={{ marginBottom: 16 }}
            >
              <option value="">Выберите машину</option>
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>

            <label className="label">АЗС (необязательно)</label>
            <input
              type="text"
              className="input"
              value={manualStation}
              onChange={(e) => setManualStation(e.target.value)}
              style={{ marginBottom: 16 }}
            />

            <label className="label">Объём, л</label>
            <input
              type="number"
              className="input"
              value={manualVolume}
              onChange={(e) => setManualVolume(e.target.value)}
              style={{ marginBottom: 16 }}
            />

            <label className="label">Сумма, ₽</label>
            <input
              type="number"
              className="input"
              value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value)}
              style={{ marginBottom: 20 }}
            />

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                className="pill-btn"
                onClick={() => {
                  setManualOpen(false);
                  resetManualForm();
                }}
              >
                Отмена
              </button>
              <button
                className="pill-btn solid"
                disabled={!manualTruckId || !manualVolume || !manualAmount || manualSaving}
                onClick={handleManualSubmit}
              >
                {manualSaving ? "Сохранение..." : "Сохранить"}
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
          <MultiSelect
            label="АЗС"
            options={stationOptions}
            selected={stationFilter}
            onChange={(s) => {
              setStationFilter(s);
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
          <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 4px" }}>Записей в выборке</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{filtered.length}</p>
        </div>
        <div className="fcard" style={{ flex: 1 }}>
          <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 4px" }}>Объём по выборке</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{totalVolume.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} л</p>
        </div>
        <div className="fcard" style={{ flex: 1 }}>
          <p style={{ fontSize: 12, color: "var(--smoke)", margin: "0 0 4px" }}>Сумма по выборке</p>
          <p style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{money(totalAmount)}</p>
        </div>
      </div>

      <div className="fcard">
        {loading ? (
          <p style={{ color: "var(--smoke)" }}>Загрузка...</p>
        ) : records.length === 0 ? (
          <p style={{ color: "var(--smoke)" }}>Пока нет записей о топливе. Импортируйте файл или добавьте запись вручную.</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: "var(--smoke)" }}>Нет записей, соответствующих текущим фильтрам.</p>
        ) : (
          <>
            {/* Панель массового выбора — только для admin, появляется когда что-то выбрано */}
            {isAdmin && selected.size > 0 && (
              <div style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 14px", marginBottom: 12,
                background: "var(--iris-soft, #eef2ff)", borderRadius: 10,
                border: "1px solid var(--iris)",
                animation: "fadeIn 0.15s ease-out",
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--iris)", flex: 1 }}>
                  Выбрано: {selected.size}
                  {selected.size < filtered.length && (
                    <button
                      onClick={selectAll}
                      style={{ marginLeft: 10, fontSize: 12, color: "var(--iris)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}
                    >
                      Выбрать все {filtered.length}
                    </button>
                  )}
                </span>
                <button
                  className="pill-btn"
                  style={{ background: "var(--ember)", color: "#fff", borderColor: "var(--ember)", fontSize: 13 }}
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Icon name="download" size={15} /> Удалить выбранные
                </button>
                <button className="pill-btn" style={{ fontSize: 13 }} onClick={clearSelection}>
                  Снять выбор
                </button>
              </div>
            )}

            <div className="tbl-scroll">
              <table>
                <thead>
                  <tr>
                    {isAdmin && (
                      <th style={{ width: 36, paddingRight: 4 }}>
                        <input
                          ref={checkAllRef}
                          type="checkbox"
                          style={{ cursor: "pointer" }}
                          onChange={(e) => togglePage(e.target.checked)}
                          title="Выбрать всё на странице"
                        />
                      </th>
                    )}
                    <Th label="Дата" sortKeyName="date" />
                    <Th label="АЗС" sortKeyName="station_label" />
                    <Th label="Машина" sortKeyName="truck_label" />
                    <Th label="Карта №" sortKeyName="card_number" />
                    <Th label="Объём, л" sortKeyName="volume" />
                    <th>Цена за литр</th>
                    <Th label="Сумма" sortKeyName="amount" />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r) => (
                    <tr
                      key={r.id}
                      style={selected.has(r.id) ? { background: "var(--iris-soft, #eef2ff)" } : undefined}
                    >
                      {isAdmin && (
                        <td style={{ paddingRight: 4, width: 36 }}>
                          <input
                            type="checkbox"
                            checked={selected.has(r.id)}
                            onChange={() => toggleRow(r.id)}
                            style={{ cursor: "pointer" }}
                          />
                        </td>
                      )}
                      <td>{fmtDateTime(r.date)}</td>
                      <td>
                        {r.station ? (
                          r.station
                        ) : !r.external_id ? (
                          <span className="tag tag-neutral">Вручную</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{truckLabel(r)}</td>
                      <td>{r.card_number || "—"}</td>
                      <td>{r.volume.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}</td>
                      <td>{r.volume ? money(r.amount / r.volume) : "—"}</td>
                      <td>{money(r.amount)}</td>
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
