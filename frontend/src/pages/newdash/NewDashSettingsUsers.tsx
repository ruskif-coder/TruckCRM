/**
 * NewDashSettingsUsers — вкладка «Пользователи» (/newdash/settings/users, admin).
 * Порт UsersTable: CRUD учёток и ролей, привязка водителя, согласие ПД. Стили .nd.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import { useAuth } from "../../auth/AuthContext";
import NewDashSettingsShell from "./NewDashSettingsShell";
import NdSortReset from "./NdSortReset";
import NdModal from "./NdModal";
import NdDataTable from "./NdDataTable";
import type { Column } from "./NdDataTable";
import { NdField, NdSearch, fmtDateTime } from "./shared";

type User = {
  id: number; username: string; role: string; full_name: string; is_active: boolean;
  driver_id: number | null; email: string | null; consent_given_at: string | null;
};
type Driver = { id: number; name: string };
type Row = User & { roleLabel: string; driverLabel: string };

const ROLE_OPTIONS = [
  { value: "admin", label: "Администратор" }, { value: "foreman", label: "Бригадир" },
  { value: "accountant", label: "Бухгалтер" }, { value: "driver", label: "Водитель" },
];
const roleLabel = (v: string) => ROLE_OPTIONS.find(o => o.value === v)?.label || v;

type FS = { username: string; full_name: string; role: string; is_active: boolean; password: string; driver_id: string; email: string };
const EMPTY: FS = { username: "", full_name: "", role: "foreman", is_active: true, password: "", driver_id: "", email: "" };
function toForm(u: User): FS {
  return { username: u.username, full_name: u.full_name || "", role: u.role, is_active: u.is_active, password: "", driver_id: u.driver_id != null ? String(u.driver_id) : "", email: u.email || "" };
}
const fmtDt = (iso: string | null) => fmtDateTime(iso, { year: "numeric", utc: true });

export default function NewDashSettingsUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dense, setDense] = useState(true);
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});

  const [editId, setEditId] = useState<number | null>(null);   // null закрыто, 0 новый, >0 правка
  const [form, setForm] = useState<FS>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function loadAll() {
    setLoading(true);
    Promise.all([api.get<User[]>("/api/users/"), api.get<Driver[]>("/api/drivers/")])
      .then(([u, d]) => { setUsers(u); setDrivers(d); setError(null); })
      .catch(e => setError(e instanceof ApiError ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { loadAll(); }, []);

  const driverName = (id: number | null) => (id == null ? "—" : drivers.find(d => d.id === id)?.name || `Водитель #${id}`);

  const rows: Row[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    return users
      .map(u => ({ ...u, roleLabel: roleLabel(u.role), driverLabel: (u.role === "driver" || u.role === "foreman") ? driverName(u.driver_id) : "—" }))
      .filter(r => !s || `${r.username} ${r.full_name} ${r.roleLabel}`.toLowerCase().includes(s));
  }, [users, drivers, q]);

  const setF = (k: keyof FS, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));
  function openCreate() { setForm(EMPTY); setFormError(null); setEditId(0); }
  function openEdit(u: User) { setForm(toForm(u)); setFormError(null); setEditId(u.id); }

  async function handleSave() {
    if (!form.username.trim()) { setFormError("Укажите логин"); return; }
    if (!editId && !form.password.trim()) { setFormError("Укажите пароль для новой учётки"); return; }
    if (form.role === "driver" && !form.driver_id) { setFormError("Для роли «Водитель» выберите карточку водителя — иначе доступ к собственным рейсам/заправкам работать не будет"); return; }
    setSaving(true); setFormError(null);
    try {
      const payload: Record<string, unknown> = {
        username: form.username.trim(), full_name: form.full_name, role: form.role, is_active: form.is_active,
        driver_id: (form.role === "driver" || form.role === "foreman") && form.driver_id ? Number(form.driver_id) : null,
        email: form.email.trim() || null,
      };
      if (form.password.trim()) payload.password = form.password.trim();
      if (editId) await api.put(`/api/users/${editId}`, payload);
      else await api.post("/api/users/", payload);
      setEditId(null); loadAll();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  }
  async function handleDelete() {
    if (!editId) return;
    if (editId === me?.id) { setFormError("Нельзя удалить собственную учётку, под которой вы сейчас авторизованы"); return; }
    if (!window.confirm("Удалить пользователя?")) return;
    setSaving(true);
    try { await api.delete(`/api/users/${editId}`); setEditId(null); loadAll(); }
    catch (e) { setFormError(e instanceof ApiError ? e.message : "Ошибка удаления"); }
    finally { setSaving(false); }
  }

  const columns: Column<Row>[] = [
    { key: "username", label: "Логин", type: "id", width: "minmax(140px, 1fr)", sticky: true, strong: true,
      render: r => <span>{r.username}{r.id === me?.id && <span className="muted" style={{ fontSize: 11, marginLeft: 5 }}>(вы)</span>}</span> },
    { key: "full_name", label: "ФИО", type: "text", width: "minmax(160px, 1.4fr)", format: v => (v as string) || "—" },
    { key: "roleLabel", label: "Роль", type: "text", width: "150px" },
    { key: "driverLabel", label: "Водитель", type: "text", width: "minmax(140px, 1fr)" },
    { key: "is_active", label: "Статус", type: "status", width: "130px", tone: r => (r.is_active ? "ok" : "idle"), format: (_v, r) => (r ? (r.is_active ? "Активен" : "Отключён") : "") },
  ];

  const editingUser = editId ? users.find(u => u.id === editId) : undefined;

  return (
    <NewDashSettingsShell
      title="Пользователи" subtitle={`учёток · ${users.length}`} adminOnly
      right={<>
        <button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Обычно" : "Компактно"}</button>
        <button className="btn btn--accent" onClick={openCreate}>Добавить пользователя</button>
      </>}
    >
      <div className="filterbar">
        <NdSearch value={q} onChange={setQ} placeholder="Логин, ФИО, роль…" />
        <NdSortReset active={sorted} onReset={() => resetSortRef.current()} />
      </div>

      <div style={{ flex: 1, minHeight: 0, padding: "12px 32px 20px", display: "flex", flexDirection: "column" }}>
        <NdDataTable<Row>
          columns={columns} rows={rows} loading={loading} dense={dense} rowId={r => r.id}
          onSortActive={setSorted} resetRef={resetSortRef}
          sortKey="username" sortDir={1} onRowClick={r => openEdit(r)}
          empty={error ? "Не удалось загрузить" : "Пользователей нет"} emptyHint={error ? "Проверьте доступ" : "Добавьте первого пользователя"}
        />
      </div>

      {editId !== null && (
        <NdModal
          size="sheet" head="dark"
          title={editId ? (form.full_name || form.username || "Пользователь") : "Новый пользователь"}
          subtitle={editId ? "Карточка пользователя" : "Заполните карточку"}
          avatar={(form.full_name[0] || form.username[0] || "?").toUpperCase()}
          status={editId ? { label: form.is_active ? "Активен" : "Отключён", tone: form.is_active ? "ok" : "idle" } : undefined}
          onClose={() => setEditId(null)}
          actions={[
            ...(editId ? [{ label: "Удалить", kind: "quiet" as const, disabled: saving || editId === me?.id, onClick: handleDelete }] : []),
            { label: "Отмена", kind: "ghost", onClick: () => setEditId(null) },
            { label: saving ? "Сохранение…" : "Сохранить", kind: "accent", grow: true, disabled: saving, onClick: handleSave },
          ]}
        >
          <section className="section">
            <div className="t-mono-label section__title">Учётная запись</div>
            <div className="form-grid">
              <NdField label="Логин" v={form.username} on={v => setF("username", v)} />
              <NdField label="ФИО" v={form.full_name} on={v => setF("full_name", v)} />
              <NdField label="Эл. почта (для сброса пароля)" type="email" wide v={form.email} on={v => setF("email", v)} />
              <div className="field"><span className="field__label">Роль</span>
                <select className="field__input" value={form.role} onChange={e => setF("role", e.target.value)}>
                  {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="field"><span className="field__label">Статус</span>
                <button type="button" className="switch" aria-pressed={form.is_active} onClick={() => setF("is_active", !form.is_active)} style={{ alignSelf: "flex-start" }}><span className="switch__track"><span className="switch__knob" /></span>{form.is_active ? "Активен" : "Отключён"}</button>
              </div>
              {(form.role === "driver" || form.role === "foreman") && (
                <div className="field form-grid__field--wide"><span className="field__label">Карточка водителя{form.role === "foreman" && <span className="muted" style={{ fontWeight: 400 }}> (опционально — для перехода «← Водитель»)</span>}</span>
                  <select className="field__input" value={form.driver_id} onChange={e => setF("driver_id", e.target.value)}>
                    <option value="">— выберите —</option>
                    {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              )}
              <NdField label={editId ? "Новый пароль (пусто — не менять)" : "Пароль"} type="password" wide v={form.password} on={v => setF("password", v)} />
            </div>
            {editId && editingUser && (
              <div className="act-warn" style={{ marginTop: 12 }}>
                <span className={`dot dot--${editingUser.consent_given_at ? "ok" : "off"}`} />
                Согласие с политикой ПД: {editingUser.consent_given_at ? `✓ ${fmtDt(editingUser.consent_given_at)}` : "не получено"}
              </div>
            )}
          </section>
          {formError && <div className="field__error">{formError}</div>}
        </NdModal>
      )}
    </NewDashSettingsShell>
  );
}
