/**
 * NewDashSettingsRoles — вкладка «Роли» (/newdash/settings/roles, admin).
 * Порт RolesTab: матрица зона×роль (чтение/запись) по /api/role-permissions/.
 * Admin всегда имеет полный доступ и в матрицу не входит. Стили .nd.
 */
import { Fragment, useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import NewDashSettingsShell from "./NewDashSettingsShell";

type Row = {
  zone: string; zone_label: string; role: string; role_label: string;
  can_read: boolean; can_write: boolean; write_applicable: boolean;
};

export default function NewDashSettingsRoles() {
  const [matrix, setMatrix] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function load() {
    setLoading(true); setError(null);
    api.get<Row[]>("/api/role-permissions/")
      .then(setMatrix)
      .catch(e => setError(e instanceof ApiError ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const zones: { zone: string; label: string; writeApplicable: boolean }[] = [];
  const roles: { role: string; label: string }[] = [];
  const seenZ = new Set<string>(), seenR = new Set<string>();
  for (const row of matrix) {
    if (!seenZ.has(row.zone)) { seenZ.add(row.zone); zones.push({ zone: row.zone, label: row.zone_label, writeApplicable: row.write_applicable }); }
    if (!seenR.has(row.role)) { seenR.add(row.role); roles.push({ role: row.role, label: row.role_label }); }
  }
  const cellMap = new Map<string, Row>();
  for (const row of matrix) cellMap.set(`${row.zone}:${row.role}`, row);

  function toggle(zone: string, role: string, field: "can_read" | "can_write") {
    setSaved(false);
    setMatrix(prev => prev.map(r => (r.zone === zone && r.role === role ? { ...r, [field]: !r[field] } : r)));
  }
  async function handleSave() {
    setSaving(true); setError(null);
    try {
      await api.put("/api/role-permissions/", { items: matrix.map(r => ({ zone: r.zone, role: r.role, can_read: r.can_read, can_write: r.can_write })) });
      setSaved(true);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  }

  const gridCols = `minmax(200px, 1.6fr) repeat(${roles.length * 2}, minmax(78px, 1fr))`;

  return (
    <NewDashSettingsShell
      title="Роли" subtitle="доступ по разделам" adminOnly
      right={<button className="btn btn--accent" disabled={saving || loading} onClick={handleSave}>{saving ? "Сохранение…" : saved ? "Сохранено" : "Сохранить"}</button>}
    >
      <div style={{ flex: 1, minHeight: 0, padding: "12px 32px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        <p className="t-body-s muted" style={{ margin: 0, maxWidth: 820 }}>
          Доступ к разделам для ролей «Бригадир», «Бухгалтер» и «Водитель» — у admin полный доступ всегда, независимо от этой таблицы.
          Разделы «Пользователи», «Настройки», «Условия оплаты» и «Партии рейсов» в таблицу не входят и остаются доступны только admin.
        </p>
        {error && <div className="field__error">{error}</div>}

        <div className="table-card" style={{ flex: 1, minHeight: 0 }}>
          <div className="table-scroll">
            {loading ? (
              <div className="t-body-s muted" style={{ padding: 40, textAlign: "center" }}>Загрузка…</div>
            ) : (
              <div className="roles-matrix" style={{ gridTemplateColumns: gridCols }}>
                {/* группа-заголовок */}
                <div className="rm-h rm-corner" style={{ gridRow: "span 2" }}>Раздел</div>
                {roles.map(r => <div key={r.role} className="rm-h rm-group" style={{ gridColumn: "span 2" }}>{r.label}</div>)}
                {/* под-заголовок */}
                {roles.map(r => (
                  <Fragment key={r.role}>
                    <div className="rm-h rm-sub">Чтение</div>
                    <div className="rm-h rm-sub rm-sub--w">Запись</div>
                  </Fragment>
                ))}
                {/* строки зон */}
                {zones.map((z, zi) => (
                  <Fragment key={z.zone}>
                    <div className={"rm-zone" + (zi % 2 ? " rm-row-even" : "")}>{z.label}</div>
                    {roles.map(r => {
                      const cell = cellMap.get(`${z.zone}:${r.role}`);
                      return (
                        <Fragment key={r.role}>
                          <div className={"rm-cell" + (zi % 2 ? " rm-row-even" : "")}>
                            <input type="checkbox" checked={!!cell?.can_read} onChange={() => toggle(z.zone, r.role, "can_read")} />
                          </div>
                          <div className={"rm-cell rm-sub--w" + (zi % 2 ? " rm-row-even" : "")}>
                            {z.writeApplicable
                              ? <input type="checkbox" checked={!!cell?.can_write} onChange={() => toggle(z.zone, r.role, "can_write")} />
                              : <span className="muted">—</span>}
                          </div>
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </NewDashSettingsShell>
  );
}
