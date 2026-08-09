/**
 * NewDashRepair — раздел «Ремонт» (/newdash/repair).
 * Порт журнала заявок на ремонт (старая Repairs.tsx): фильтр по статусу,
 * сортировка, срочность, продвижение статуса (создана→в работе→закрыта с
 * комментарием), фото. Данные /api/repair-requests/journal/. Стили — .nd.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, fileUrl } from "../../api";
import NdMenu from "./NdMenu";
import NdMultiSelect from "./NdMultiSelect";
import NdSortReset from "./NdSortReset";
import NdModal from "./NdModal";
import NdDataTable from "./NdDataTable";
import type { Column } from "./NdDataTable";
import { fmtDateTime, NdSearch } from "./shared";
import "./newdash.css";

type RepairRow = {
  id: number; driver_id: number | null; truck_id: number | null;
  text: string; photo_paths: string; priority: string; close_comment: string;
  created_at: string; status: string; driver_name: string; truck_label: string;
};

const STATUS_NEXT: Record<string, string> = { "новая": "в работе", "создана": "в работе", "в работе": "закрыта", "закрыта": "закрыта" };
const STATUS_LABEL: Record<string, string> = { "новая": "Создана", "создана": "Создана", "в работе": "В работе", "закрыта": "Закрыта" };
const statusTone = (s: string) => (s === "в работе" ? "warn" : s === "закрыта" ? "ok" : "idle");
const normStatus = (s: string) => (s === "новая" ? "создана" : s);
const STATUS_OPTS = ["Создана", "В работе", "Закрыта"];
const OPT_TO_VALUE: Record<string, string> = { "Создана": "создана", "В работе": "в работе", "Закрыта": "закрыта" };

function parsePhotos(raw: string): string[] { if (!raw) return []; try { return JSON.parse(raw); } catch { return []; } }

export default function NewDashRepair() {
  const [rows, setRows] = useState<RepairRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dense, setDense] = useState(true);
  const [statusF, setStatusF] = useState<Set<string>>(new Set());
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});

  const [advancingId, setAdvancingId] = useState<number | null>(null);
  const [closeDialog, setCloseDialog] = useState<{ rowId: number; comment: string } | null>(null);

  function load() {
    setLoading(true);
    api.get<RepairRow[]>("/api/repair-requests/journal/")
      .then(d => { setRows(d); setError(null); })
      .catch(e => setError(e instanceof ApiError ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const selectedStatuses = useMemo(() => new Set([...statusF].map(o => OPT_TO_VALUE[o] || o)), [statusF]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter(r =>
      (selectedStatuses.size === 0 || selectedStatuses.has(normStatus(r.status))) &&
      (!s || `${r.truck_label} ${r.driver_name} ${r.text}`.toLowerCase().includes(s)));
  }, [rows, selectedStatuses, q]);

  async function doAdvance(id: number, nextStatus: string, closeComment: string) {
    setAdvancingId(id);
    try {
      const body: Record<string, string> = { status: nextStatus };
      if (closeComment) body.close_comment = closeComment;
      await api.put(`/api/repair-requests/${id}`, body);
      setRows(prev => prev.map(r => r.id === id ? { ...r, status: nextStatus, close_comment: closeComment || r.close_comment } : r));
    } catch { /* тихо */ } finally { setAdvancingId(null); }
  }
  function handleStatusClick(row: RepairRow) {
    const next = STATUS_NEXT[row.status] ?? row.status;
    if (next === row.status) return;
    if (next === "закрыта") setCloseDialog({ rowId: row.id, comment: "" });
    else doAdvance(row.id, next, "");
  }

  const columns: Column<RepairRow>[] = [
    { key: "priority", label: "", type: "text", width: "40px", sortValue: r => (r.priority === "срочная" ? 0 : 1),
      render: r => (r.priority === "срочная" ? <span className="dot dot--crit" title="Срочная заявка" /> : <span className="muted">·</span>) },
    { key: "created_at", label: "Дата", type: "date", width: "150px", sticky: true, strong: true, format: v => fmtDateTime(v, { utc: true }) },
    { key: "truck_label", label: "Машина", type: "id", width: "130px" },
    { key: "driver_name", label: "Водитель", type: "text", width: "minmax(140px, 1fr)" },
    { key: "text", label: "Проблема", type: "text", width: "minmax(240px, 2fr)",
      render: r => (
        <span title={r.text + (r.close_comment ? `\n✓ ${r.close_comment}` : "")} style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {r.priority === "срочная" && <span className="status status--risk" style={{ flex: "none" }}>СРОЧНО</span>}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.text}</span>
          {r.close_comment && <span className="muted" title={`✓ ${r.close_comment}`} style={{ flex: "none" }}>✓</span>}
        </span>
      ) },
    { key: "photos", label: "Фото", type: "text", width: "96px", sortValue: r => parsePhotos(r.photo_paths).length,
      render: r => {
        const ph = parsePhotos(r.photo_paths);
        if (!ph.length) return <span className="muted">—</span>;
        return <span style={{ display: "inline-flex", gap: 4 }} onClick={e => e.stopPropagation()}>
          {ph.map((p, i) => <a key={i} href={fileUrl(`/photos/${p}`)} target="_blank" rel="noreferrer" title="Открыть фото" style={{ textDecoration: "none", fontSize: 15 }}>📷</a>)}
        </span>;
      } },
    { key: "status", label: "Статус", type: "text", width: "128px", sortValue: r => normStatus(r.status),
      render: r => {
        const label = STATUS_LABEL[r.status] ?? r.status;
        const next = STATUS_NEXT[r.status] ?? r.status;
        const canAdvance = next !== r.status;
        return (
          <button type="button" className={`status status--${statusTone(r.status)}`}
            disabled={!canAdvance || advancingId === r.id}
            title={canAdvance ? `${label} → ${STATUS_LABEL[next] ?? next}` : "Заявка закрыта"}
            style={{ cursor: canAdvance ? "pointer" : "default", border: 0, opacity: advancingId === r.id ? 0.5 : 1 }}
            onClick={e => { e.stopPropagation(); handleStatusClick(r); }}>
            {label}
          </button>
        );
      } },
  ];

  const openCount = rows.filter(r => normStatus(r.status) !== "закрыта").length;

  return (
    <div className="nd">
      <NdMenu active="repair" />
      <main className="main">
        <header className="topbar">
          <div className="topbar__title">
            <h1 className="t-h1" style={{ margin: 0 }}>Заявки на ремонт</h1>
            <span className="t-mono muted">открытых · {openCount}</span>
          </div>
          <div className="spacer" />
          <NdSearch value={q} onChange={setQ} placeholder="Машина, водитель, проблема…" />
        </header>

        <div className="filterbar">
          <NdMultiSelect label="Статус" options={STATUS_OPTS} selected={statusF} onChange={setStatusF} />
          <NdSortReset active={sorted} onReset={() => resetSortRef.current()} />
          <div className="spacer" />
          <button className="btn btn--ghost" disabled={loading} onClick={load}>Обновить</button>
          <button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Обычно" : "Компактно"}</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: "12px 24px 20px", display: "flex", flexDirection: "column" }}>
          <NdDataTable<RepairRow>
            columns={columns} rows={visible} loading={loading} dense={dense} rowId={r => r.id}
            onSortActive={setSorted} resetRef={resetSortRef}
            sortKey="created_at" sortDir={-1}
            empty={error ? "Не удалось загрузить" : "Заявок на ремонт нет"}
            emptyHint={error ? "Проверьте доступ" : "Заявки создают водители из мобильного кабинета"}
          />
        </div>
      </main>

      {closeDialog && (
        <NdModal
          size="form"
          title="Закрыть заявку"
          subtitle="Что было сделано? (необязательно)"
          onClose={() => setCloseDialog(null)}
          actions={[
            { label: "Отмена", kind: "ghost", onClick: () => setCloseDialog(null) },
            { label: advancingId !== null ? "…" : "Закрыть заявку", kind: "accent", grow: true, disabled: advancingId !== null,
              onClick: async () => { const { rowId, comment } = closeDialog; setCloseDialog(null); await doAdvance(rowId, "закрыта", comment); } },
          ]}
        >
          <div className="field">
            <span className="field__label">Комментарий</span>
            <textarea rows={3} className="field__input" value={closeDialog.comment}
              onChange={e => setCloseDialog(d => d ? { ...d, comment: e.target.value } : null)}
              placeholder="Например: заменена деталь, устранена утечка масла…"
              style={{ resize: "vertical", minHeight: 64 }} />
          </div>
        </NdModal>
      )}
    </div>
  );
}
