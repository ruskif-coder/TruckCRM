/**
 * NewDashSettingsCategories — вкладка «Статьи» (/newdash/settings/categories, admin).
 * Порт CategoriesTab: справочник статей расходов — добавление, инлайн-переименование,
 * доступ по ролям, активность, перетаскивание порядка (мгновенное сохранение). Стили .nd.
 */
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import NewDashSettingsShell from "./NewDashSettingsShell";

type ExpCat = { id: number; name: string; allowed_roles: string; active: boolean; sort_order: number };
const ALL_ROLES = ["driver", "foreman", "accountant"];
const ROLE_LABELS: Record<string, string> = { driver: "Водитель", foreman: "Бригадир", accountant: "Бухгалтер" };
const parseRoles = (raw: string): string[] => { try { return JSON.parse(raw) as string[]; } catch { return []; } };

const W_HANDLE = 36, W_ROLE = 110, W_ACTIVE = 100;

export default function NewDashSettingsCategories() {
  const [cats, setCats] = useState<ExpCat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  const [addName, setAddName] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editNameId, setEditNameId] = useState<number | null>(null);
  const [editNameVal, setEditNameVal] = useState("");

  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  function load() {
    setLoading(true); setError(null);
    api.get<ExpCat[]>("/api/expense-categories/")
      .then(setCats).catch(() => setError("Ошибка загрузки")).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (editNameId !== null) editRef.current?.focus(); }, [editNameId]);

  async function patchCat(c: ExpCat, patch: Partial<ExpCat>) {
    const updated = { ...c, ...patch };
    setSaving(p => ({ ...p, [c.id]: true }));
    try {
      await api.put(`/api/expense-categories/${c.id}`, {
        name: updated.name, allowed_roles: parseRoles(updated.allowed_roles), active: updated.active, sort_order: updated.sort_order,
      });
      setCats(p => p.map(x => x.id === c.id ? { ...x, ...patch } : x));
    } catch { /* тихо */ } finally { setSaving(p => ({ ...p, [c.id]: false })); }
  }
  async function toggleRole(c: ExpCat, role: string, checked: boolean) {
    const next = checked ? [...parseRoles(c.allowed_roles), role] : parseRoles(c.allowed_roles).filter(r => r !== role);
    setCats(p => p.map(x => x.id === c.id ? { ...x, allowed_roles: JSON.stringify(next) } : x));
    await patchCat({ ...c, allowed_roles: JSON.stringify(next) }, {});
  }
  async function handleAdd() {
    if (!addName.trim()) { setAddError("Введите название"); return; }
    setAddSaving(true); setAddError(null);
    try {
      await api.post("/api/expense-categories/", { name: addName.trim(), allowed_roles: ALL_ROLES, active: true, sort_order: cats.length });
      setAddName(""); load();
    } catch (e) { setAddError(e instanceof ApiError ? e.message : "Ошибка"); }
    finally { setAddSaving(false); }
  }
  async function saveName(c: ExpCat) {
    if (editNameVal.trim() && editNameVal.trim() !== c.name) await patchCat(c, { name: editNameVal.trim() });
    setEditNameId(null);
  }
  async function handleDrop(targetId: number) {
    if (dragId === null || dragId === targetId) return;
    const from = cats.findIndex(c => c.id === dragId), to = cats.findIndex(c => c.id === targetId);
    if (from === -1 || to === -1) return;
    const next = [...cats];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const withOrders = next.map((c, i) => ({ ...c, sort_order: i }));
    const orig = new Map(cats.map(c => [c.id, c.sort_order]));
    setCats(withOrders); setDragId(null); setDragOverId(null);
    for (const c of withOrders) if (orig.get(c.id) !== c.sort_order) patchCat(c, {}).catch(() => {});
  }

  return (
    <NewDashSettingsShell title="Статьи расходов" subtitle={`статей · ${cats.length}`} adminOnly>
      <div className="filterbar">
        <div className="search" style={{ width: 300 }}>
          <input value={addName} onChange={e => { setAddName(e.target.value); setAddError(null); }}
            placeholder="Новая статья…" onKeyDown={e => e.key === "Enter" && handleAdd()}
            style={{ flex: 1, minWidth: 0, border: 0, background: "none", outline: "none", font: "400 12.5px var(--font-ui)", color: "var(--ink)" }} />
        </div>
        <button className="btn btn--accent" onClick={handleAdd} disabled={addSaving}>{addSaving ? "…" : "Добавить"}</button>
        {addError && <span className="field__error" style={{ margin: 0 }}>{addError}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "12px 32px 20px", display: "flex", flexDirection: "column" }}>
        {error && <div className="field__error" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="table-card" style={{ flex: 1, minHeight: 0 }}>
          <div className="table-scroll">
            {loading ? (
              <div className="t-body-s muted" style={{ padding: 40, textAlign: "center" }}>Загрузка…</div>
            ) : cats.length === 0 ? (
              <div style={{ padding: "56px 20px", textAlign: "center" }}>
                <div className="t-h3" style={{ color: "var(--text-2)" }}>Статей пока нет</div>
                <div className="t-body-s muted" style={{ marginTop: 6 }}>Добавьте первую статью в поле выше.</div>
              </div>
            ) : (
              <div>
                <div className="cat-row cat-head">
                  <div className="cat-handle" style={{ width: W_HANDLE }} title="Перетащить для изменения порядка">⠿</div>
                  <div style={{ flex: 1, minWidth: 200 }}>Статья</div>
                  {ALL_ROLES.map(r => <div key={r} style={{ width: W_ROLE, textAlign: "center" }}>{ROLE_LABELS[r]}</div>)}
                  <div style={{ width: W_ACTIVE, textAlign: "center" }}>Активна</div>
                </div>
                {cats.map(c => {
                  const roles = parseRoles(c.allowed_roles);
                  const isSaving = !!saving[c.id];
                  const cls = "cat-row" + (dragId === c.id ? " cat-row--drag" : "") + (dragOverId === c.id && dragId !== c.id ? " cat-row--over" : "");
                  return (
                    <div key={c.id} className={cls} draggable
                      onDragStart={() => setDragId(c.id)}
                      onDragOver={e => { e.preventDefault(); setDragOverId(c.id); }}
                      onDrop={() => handleDrop(c.id)}
                      onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                      style={{ opacity: isSaving ? 0.6 : undefined }}
                    >
                      <div className="cat-handle" style={{ width: W_HANDLE }}>⠿</div>
                      <div style={{ flex: 1, minWidth: 200, color: c.active ? undefined : "var(--text-3)", fontSize: 13 }}>
                        {editNameId === c.id ? (
                          <input ref={editRef} className="field__input" value={editNameVal}
                            onChange={e => setEditNameVal(e.target.value)} onBlur={() => saveName(c)}
                            onKeyDown={e => { if (e.key === "Enter") saveName(c); if (e.key === "Escape") setEditNameId(null); }}
                            style={{ minWidth: 160 }} />
                        ) : (
                          <span title="Двойной клик — изменить" style={{ cursor: "text" }} onDoubleClick={() => { setEditNameId(c.id); setEditNameVal(c.name); }}>{c.name}</span>
                        )}
                      </div>
                      {ALL_ROLES.map(r => (
                        <div key={r} className="cat-check" style={{ width: W_ROLE }}>
                          <input type="checkbox" checked={roles.includes(r)} disabled={isSaving} onChange={e => toggleRole(c, r, e.target.checked)} />
                        </div>
                      ))}
                      <div className="cat-check" style={{ width: W_ACTIVE }}>
                        <input type="checkbox" checked={c.active} disabled={isSaving} onChange={e => patchCat(c, { active: e.target.checked })}
                          title={c.active ? "Отключить статью" : "Включить статью"} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <p className="t-body-s muted" style={{ margin: "10px 0 0" }}>
          Перетащите строку за ⠿ чтобы изменить порядок. Двойной клик по названию — изменить. Все изменения сохраняются мгновенно.
        </p>
      </div>
    </NewDashSettingsShell>
  );
}
