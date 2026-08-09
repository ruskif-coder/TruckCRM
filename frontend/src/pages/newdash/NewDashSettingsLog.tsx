/**
 * NewDashSettingsLog — вкладка «Журнал» (/newdash/settings/log, admin).
 * Порт LogTab: журнал действий /api/audit-log/ с фильтрами (раздел/действие)
 * и раскрытием изменений по полям. Стили .nd.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import NewDashSettingsShell from "./NewDashSettingsShell";
import NdSortReset from "./NdSortReset";
import NdDataTable from "./NdDataTable";
import type { Column } from "./NdDataTable";
import { fmtDateTime } from "./shared";

type Entry = {
  id: number; created_at: string; user_id: number | null; username: string; role: string;
  action: string; zone: string; entity_id: number | null; summary: string; changes_json: string;
};
type MetaOption = { value: string; label: string };
const fmtDt = (iso: string) => fmtDateTime(iso, { year: "numeric", utc: true });
function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function NewDashSettingsLog() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [zones, setZones] = useState<MetaOption[]>([]);
  const [actions, setActions] = useState<MetaOption[]>([]);
  const [zoneFilter, setZoneFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dense, setDense] = useState(true);
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});

  useEffect(() => {
    api.get<{ zones: MetaOption[]; actions: MetaOption[] }>("/api/audit-log/meta")
      .then(m => { setZones(m.zones); setActions(m.actions); }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true); setError(null);
    const params = new URLSearchParams();
    if (zoneFilter) params.set("zone", zoneFilter);
    if (actionFilter) params.set("action", actionFilter);
    const qs = params.toString();
    api.get<Entry[]>(`/api/audit-log/${qs ? `?${qs}` : ""}`)
      .then(setEntries)
      .catch(e => setError(e instanceof ApiError ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }, [zoneFilter, actionFilter]);

  const zoneLabel = (z: string) => zones.find(o => o.value === z)?.label || z;
  const actionLabel = (a: string) => actions.find(o => o.value === a)?.label || a;

  const columns: Column<Entry>[] = useMemo(() => [
    { key: "created_at", label: "Дата и время", type: "date", width: "168px", sticky: true, strong: true, format: v => fmtDt(v as string) },
    { key: "username", label: "Пользователь", type: "text", width: "minmax(130px, 1fr)", format: v => (v as string) || "—" },
    { key: "action", label: "Действие", type: "text", width: "130px", format: v => actionLabel(v as string) },
    { key: "zone", label: "Раздел", type: "text", width: "minmax(140px, 1fr)", format: v => zoneLabel(v as string) },
    { key: "summary", label: "Запись", type: "text", width: "minmax(240px, 2fr)", format: v => (v as string) || "—" },
  ], [zones, actions]);

  function parseChanges(e: Entry) {
    let changes: Record<string, { old: unknown; new: unknown }> = {};
    try { changes = e.changes_json ? JSON.parse(e.changes_json) : {}; } catch { changes = {}; }
    const fieldChanges = Object.entries(changes).filter(([k]) => k !== "_extra");
    const extra = changes["_extra"]?.new as Record<string, unknown> | undefined;
    return { fieldChanges, extra };
  }

  return (
    <NewDashSettingsShell
      title="Журнал" subtitle={`записей · ${entries.length}`} adminOnly
      right={<button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Обычно" : "Компактно"}</button>}
    >
      <div className="filterbar">
        <select className="field__input" style={{ width: 190 }} value={zoneFilter} onChange={e => setZoneFilter(e.target.value)}>
          <option value="">Все разделы</option>
          {zones.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
        </select>
        <select className="field__input" style={{ width: 190 }} value={actionFilter} onChange={e => setActionFilter(e.target.value)}>
          <option value="">Все действия</option>
          {actions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        <NdSortReset active={sorted} onReset={() => resetSortRef.current()} />
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "12px 32px 20px", display: "flex", flexDirection: "column" }}>
        <NdDataTable<Entry>
          columns={columns} rows={entries} loading={loading} dense={dense} rowId={r => r.id}
          onSortActive={setSorted} resetRef={resetSortRef}
          sortKey="created_at" sortDir={-1}
          empty={error ? "Не удалось загрузить" : "Записей пока нет"} emptyHint={error ? "Проверьте доступ" : "Действия появятся здесь по мере работы"}
          expand={e => {
            const { fieldChanges, extra } = parseChanges(e);
            if (!fieldChanges.length && !extra) return <div className="t-body-s muted" style={{ padding: "0 0 4px 40px" }}>Дополнительных сведений нет.</div>;
            return (
              <div style={{ padding: "0 0 4px 40px", fontSize: 12.5, display: "flex", flexDirection: "column", gap: 4 }}>
                {fieldChanges.map(([field, { old, new: nv }]) => (
                  <div key={field}><span className="muted">{field}: </span>{fmtVal(old)} → {fmtVal(nv)}</div>
                ))}
                {extra && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 18px" }}>
                    {Object.entries(extra).map(([k, v]) => <span key={k}><span className="muted">{k}: </span>{fmtVal(v)}</span>)}
                  </div>
                )}
              </div>
            );
          }}
        />
      </div>
    </NewDashSettingsShell>
  );
}
