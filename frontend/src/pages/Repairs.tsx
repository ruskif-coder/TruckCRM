/**
 * Журнал заявок на ремонт.
 * v2 (2026-07-03): фильтр по статусу, сортировка, срочность, диалог закрытия.
 */
import React, { useEffect, useState } from "react";
import { api, fileUrl } from "../api";

type RepairRow = {
  id: number;
  driver_id: number | null;
  truck_id: number | null;
  text: string;
  photo_paths: string;
  priority: string;
  close_comment: string;
  created_at: string;
  status: string;
  driver_name: string;
  truck_label: string;
};

const STATUS_NEXT: Record<string, string> = {
  "новая":    "в работе",
  "создана":  "в работе",
  "в работе": "закрыта",
  "закрыта":  "закрыта",
};

const STATUS_LABEL: Record<string, string> = {
  "новая":    "Создана",
  "создана":  "Создана",
  "в работе": "В работе",
  "закрыта":  "Закрыта",
};

const STATUS_STYLE: Record<string, React.CSSProperties> = {
  "новая":    { background: "#5683da18", color: "#5683da" },
  "создана":  { background: "#5683da18", color: "#5683da" },
  "в работе": { background: "#f39c1218", color: "#d99a3a" },
  "закрыта":  { background: "#27ae6018", color: "#27ae60" },
};

const FILTER_OPTS = [
  { label: "Все",      value: "все" },
  { label: "Создана",  value: "создана" },
  { label: "В работе", value: "в работе" },
  { label: "Закрыта",  value: "закрыта" },
];

function parsePhotos(raw: string): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Нормализуем статус «новая» → «создана» для фильтра */
function normStatus(s: string) {
  return s === "новая" ? "создана" : s;
}

export default function Repairs() {
  const [rows, setRows] = useState<RepairRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancingId, setAdvancingId] = useState<number | null>(null);

  // Фильтр и сортировка
  const [filterStatus, setFilterStatus] = useState("все");
  const [sortKey, setSortKey] = useState<"date" | "truck">("date");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  // Диалог закрытия заявки
  const [closeDialog, setCloseDialog] = useState<{ rowId: number; comment: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRows(await api.get<RepairRow[]>("/api/repair-requests/journal/"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function toggleSort(key: "date" | "truck") {
    if (sortKey === key) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // Отфильтрованные + отсортированные строки
  const visible = rows
    .filter(r => {
      if (filterStatus === "все") return true;
      return normStatus(r.status) === filterStatus;
    })
    .sort((a, b) => {
      const cmp = sortKey === "date"
        ? a.created_at.localeCompare(b.created_at)
        : a.truck_label.localeCompare(b.truck_label, "ru");
      return sortDir === "desc" ? -cmp : cmp;
    });

  // Счётчики для бейджей на кнопках фильтра
  function countByStatus(val: string) {
    return rows.filter(r => normStatus(r.status) === val).length;
  }

  // Клик по статус-бейджу строки
  function handleStatusClick(row: RepairRow) {
    const next = STATUS_NEXT[row.status] ?? row.status;
    if (next === row.status) return;
    if (next === "закрыта") {
      setCloseDialog({ rowId: row.id, comment: "" });
    } else {
      doAdvance(row.id, next, "");
    }
  }

  async function doAdvance(id: number, nextStatus: string, closeComment: string) {
    setAdvancingId(id);
    try {
      const body: Record<string, string> = { status: nextStatus };
      if (closeComment) body.close_comment = closeComment;
      await api.put(`/api/repair-requests/${id}`, body);
      setRows(prev => prev.map(r =>
        r.id === id
          ? { ...r, status: nextStatus, close_comment: closeComment || r.close_comment }
          : r
      ));
    } catch { /* ignore */ }
    finally { setAdvancingId(null); }
  }

  function sortIcon(key: "date" | "truck") {
    if (sortKey !== key) return " ⇅";
    return sortDir === "desc" ? " ↓" : " ↑";
  }

  return (
    <div>
      <div className="pagehead">
        <div className="ph-title">
          <div className="crumbs">Ремонт</div>
          <h1 className="pagetitle">Заявки на ремонт</h1>
        </div>
        <div className="head-actions">
          <button className="pill-btn" onClick={load} disabled={loading}>
            ↻ Обновить
          </button>
        </div>
      </div>

      {/* ── Фильтр по статусу ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {FILTER_OPTS.map(o => {
          const cnt = o.value === "все" ? null : countByStatus(o.value);
          return (
            <button
              key={o.value}
              onClick={() => setFilterStatus(o.value)}
              className={filterStatus === o.value ? "pill-btn solid" : "pill-btn"}
            >
              {o.label}
              {cnt !== null && (
                <span style={{ marginLeft: 5, opacity: 0.65, fontWeight: 400, fontSize: "0.85em" }}>
                  {cnt}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="fcard">
        {loading ? (
          <p style={{ color: "var(--smoke)" }}>Загрузка...</p>
        ) : visible.length === 0 ? (
          <p style={{ color: "var(--smoke)" }}>
            {filterStatus === "все" ? "Заявок на ремонт нет." : "Нет заявок с таким статусом."}
          </p>
        ) : (
          <div className="tbl-scroll">
            <table>
              <thead>
                <tr>
                  <th
                    style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                    onClick={() => toggleSort("date")}
                  >
                    Дата{sortIcon("date")}
                  </th>
                  <th
                    style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                    onClick={() => toggleSort("truck")}
                  >
                    Машина{sortIcon("truck")}
                  </th>
                  <th>Водитель</th>
                  <th>Проблема</th>
                  <th>Фото</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(row => {
                  const photos = parsePhotos(row.photo_paths);
                  const style = STATUS_STYLE[row.status] ?? STATUS_STYLE["создана"];
                  const label = STATUS_LABEL[row.status] ?? row.status;
                  const next = STATUS_NEXT[row.status] ?? row.status;
                  const canAdvance = next !== row.status;
                  const isUrgent = row.priority === "срочная";
                  return (
                    <tr
                      key={row.id}
                      style={isUrgent
                        ? { background: "rgba(231,76,60,0.05)", outline: "1.5px solid rgba(231,76,60,0.2)" }
                        : undefined
                      }
                    >
                      <td style={{ whiteSpace: "nowrap", fontSize: 13 }}>
                        {fmtDate(row.created_at)}
                      </td>
                      <td style={{ fontSize: 13 }}>{row.truck_label}</td>
                      <td style={{ fontSize: 13 }}>{row.driver_name}</td>
                      <td style={{ fontSize: 13, maxWidth: 320 }}>
                        {isUrgent && (
                          <span style={{
                            display: "inline-block", marginRight: 6,
                            background: "#e74c3c", color: "#fff",
                            borderRadius: 4, fontSize: 10, fontWeight: 700,
                            padding: "1px 5px", verticalAlign: "middle",
                          }}>
                            СРОЧНО
                          </span>
                        )}
                        {row.text}
                        {row.close_comment && (
                          <div style={{
                            fontSize: 11, color: "var(--ink2)",
                            marginTop: 3, fontStyle: "italic",
                          }}>
                            ✓ {row.close_comment}
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {photos.map((p, i) => (
                            <a
                              key={i}
                              href={fileUrl(`/photos/${p}`)}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: 18, textDecoration: "none", lineHeight: 1 }}
                              title="Открыть фото"
                            >
                              📷
                            </a>
                          ))}
                        </div>
                      </td>
                      <td>
                        <button
                          onClick={() => handleStatusClick(row)}
                          disabled={!canAdvance || advancingId === row.id}
                          title={canAdvance ? `${label} → ${STATUS_LABEL[next] ?? next}` : "Заявка закрыта"}
                          style={{
                            border: "none", borderRadius: 8,
                            padding: "4px 12px", fontSize: 12, fontWeight: 700,
                            cursor: canAdvance ? "pointer" : "default",
                            fontFamily: "inherit", transition: "opacity .15s",
                            opacity: advancingId === row.id ? 0.5 : 1,
                            whiteSpace: "nowrap",
                            ...style,
                          }}
                        >
                          {label}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Диалог закрытия заявки ── */}
      {closeDialog && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setCloseDialog(null); }}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div style={{
            background: "var(--card)",
            borderRadius: 16,
            padding: "28px 24px",
            width: "min(440px, 92vw)",
            boxShadow: "0 8px 40px rgba(0,0,0,.18)",
          }}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 10 }}>
              Закрыть заявку
            </div>
            <div style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 12 }}>
              Что было сделано? (необязательно)
            </div>
            <textarea
              value={closeDialog.comment}
              onChange={e => setCloseDialog(d => d ? { ...d, comment: e.target.value } : null)}
              rows={3}
              placeholder="Например: заменена деталь, устранена утечка масла..."
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              style={{
                width: "100%", boxSizing: "border-box",
                border: "1.5px solid var(--border)",
                borderRadius: 8, padding: "8px 10px",
                fontSize: 13, fontFamily: "inherit",
                background: "var(--bg)", color: "var(--ink)",
                resize: "vertical", marginBottom: 16,
              }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="pill-btn" onClick={() => setCloseDialog(null)}>
                Отмена
              </button>
              <button
                className="pill-btn solid"
                disabled={advancingId !== null}
                onClick={async () => {
                  const { rowId, comment } = closeDialog;
                  setCloseDialog(null);
                  await doAdvance(rowId, "закрыта", comment);
                }}
              >
                {advancingId !== null ? "…" : "Закрыть заявку"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
