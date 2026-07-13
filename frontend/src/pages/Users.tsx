import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError } from "../api";
import Icon from "../components/Icon";
import { useAuth } from "../auth/AuthContext";

// «Пользователи» (2026-06-28, "Безопасность: роли по API") — admin-only
// страница для управления учётками и их ролями (backend/app/models.ROLES =
// admin/driver/foreman/accountant, см. routers/users.py — весь роутер уже
// гейтится require_role("admin"), так что не-админ сюда физически не
// дойдёт даже если попадёт на /users напрямую). Построена по тому же
// шаблону таблица+модалка, что и вкладка «Перевозчики» в Directories.tsx.
type User = {
  id: number;
  username: string;
  role: string;
  full_name: string;
  is_active: boolean;
  driver_id: number | null;
  email: string | null;
  consent_given_at: string | null;
};

// Минимальный набор полей водителя — только для выбора привязки учётки
// роли "driver" к карточке водителя (own-data фильтр в crud.py читает
// User.driver_id, см. backend/app/models.py комментарий там же).
type Driver = { id: number; name: string };

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "admin", label: "Администратор" },
  { value: "foreman", label: "Бригадир" },
  { value: "accountant", label: "Бухгалтер" },
  { value: "driver", label: "Водитель" },
];

function roleLabel(v: string): string {
  return ROLE_OPTIONS.find((o) => o.value === v)?.label || v;
}

type UserFormState = {
  username: string;
  full_name: string;
  role: string;
  is_active: boolean;
  password: string;
  driver_id: string;
  email: string;
};

const EMPTY_FORM: UserFormState = {
  username: "",
  full_name: "",
  role: "foreman",
  is_active: true,
  password: "",
  driver_id: "",
  email: "",
};

function userToForm(u: User): UserFormState {
  return {
    username: u.username,
    full_name: u.full_name || "",
    role: u.role,
    is_active: u.is_active,
    password: "",
    driver_id: u.driver_id != null ? String(u.driver_id) : "",
    email: u.email || "",
  };
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

// 2026-06-28: страница больше не самостоятельный раздел навигации - стала
// 3-й вкладкой «Пользователи» в Настройках (см. Settings.tsx), которая сама
// решает, показывать ли вкладку не-админу (по user.role). Бэкенд всё равно
// гейтит /api/users на require_role("admin") (routers/users.py) - это
// единственный настоящий замок, всё остальное здесь - UX-слой.
export function UsersTable({ tabsNav }: { tabsNav?: ReactNode } = {}) {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [u, d] = await Promise.all([
        api.get<User[]>("/api/users/"),
        api.get<Driver[]>("/api/drivers/"),
      ]);
      setUsers(u);
      setDrivers(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(u: User) {
    setEditingId(u.id);
    setForm(userToForm(u));
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function setFieldValue<K extends keyof UserFormState>(key: K, value: UserFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function driverName(driverId: number | null): string {
    if (driverId == null) return "—";
    return drivers.find((d) => d.id === driverId)?.name || `Водитель #${driverId}`;
  }

  async function handleSave() {
    if (!form.username.trim()) {
      setFormError("Укажите логин");
      return;
    }
    if (!editingId && !form.password.trim()) {
      setFormError("Укажите пароль для новой учётки");
      return;
    }
    if (form.role === "driver" && !form.driver_id) {
      setFormError("Для роли «Водитель» выберите карточку водителя — иначе доступ к собственным рейсам/заправкам работать не будет");
      return;
    }
    if (form.role === "foreman" && !form.driver_id) {
      // Для бригадира карточка водителя опциональна, но без неё не будет работать
      // переход «← Водитель» в мобильном интерфейсе. Предупреждаем, но не блокируем.
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = {
        username: form.username.trim(),
        full_name: form.full_name,
        role: form.role,
        is_active: form.is_active,
        driver_id: (form.role === "driver" || form.role === "foreman") && form.driver_id
          ? Number(form.driver_id)
          : null,
        email: form.email.trim() || null,
      };
      if (form.password.trim()) payload.password = form.password.trim();
      if (editingId) {
        await api.put(`/api/users/${editingId}`, payload);
      } else {
        await api.post("/api/users/", payload);
      }
      setModalOpen(false);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingId) return;
    if (editingId === me?.id) {
      setFormError("Нельзя удалить собственную учётку, под которой вы сейчас авторизованы");
      return;
    }
    if (!window.confirm("Удалить пользователя?")) return;
    setSaving(true);
    setFormError(null);
    try {
      await api.delete(`/api/users/${editingId}`);
      setModalOpen(false);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Ошибка удаления");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabsNav}
        <button className="pill-btn solid" onClick={openCreate}>
          <Icon name="plus" size={17} /> <span className="lbl-hide">Добавить пользователя</span>
        </button>
      </div>

      {error && (
        <p className="fcard" style={{ color: "var(--ember)", marginBottom: 24 }}>
          {error}
        </p>
      )}

      <div className="fcard" style={{ padding: 0 }}>
        {loading ? (
          <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>Загрузка...</p>
        ) : users.length === 0 ? (
          <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>Пока нет пользователей.</p>
        ) : (
          <div className="tbl-scroll" style={{ padding: "16px 20px" }}>
            <table>
              <thead>
                <tr>
                  <th>Логин</th>
                  <th>ФИО</th>
                  <th>Роль</th>
                  <th>Водитель</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} onClick={() => openEdit(u)} style={{ cursor: "pointer" }}>
                    <td>
                      {u.username}
                      {u.id === me?.id && (
                        <span style={{ color: "var(--ink-3)", fontSize: 12 }}> (вы)</span>
                      )}
                    </td>
                    <td>{u.full_name || "—"}</td>
                    <td>{roleLabel(u.role)}</td>
                    <td>{(u.role === "driver" || u.role === "foreman") ? driverName(u.driver_id) : "—"}</td>
                    <td>
                      <span className={`status ${u.is_active ? "st-route" : "st-free"}`}>
                        <span className="sd" />
                        {u.is_active ? "Активен" : "Отключён"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="modal-overlay">
          <div className="fcard" style={{ width: 520, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", padding: 0 }}>
            <div
              style={{
                background: "var(--dark)",
                color: "#fff",
                padding: "16px 24px",
                borderRadius: "26px 26px 0 0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h2 style={{ fontSize: 18, margin: 0 }}>{editingId ? "Карточка пользователя" : "Новый пользователь"}</h2>
              <button
                type="button"
                onClick={closeModal}
                style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: 24 }}>
              <Row>
                <TextField label="Логин" value={form.username} onChange={(v) => setFieldValue("username", v)} />
                <TextField label="ФИО" value={form.full_name} onChange={(v) => setFieldValue("full_name", v)} />
              </Row>

              <Row>
                <TextField
                  label="Эл. почта (для сброса пароля)"
                  type="email"
                  value={form.email}
                  onChange={(v) => setFieldValue("email", v)}
                />
              </Row>

              {/* Дата согласия с ПД — только в режиме редактирования */}
              {editingId && (() => {
                const u = users.find((x) => x.id === editingId);
                if (!u) return null;
                return (
                  <div style={{ marginBottom: 16, padding: "10px 14px", background: "var(--bg-alt, #f7f8fa)", borderRadius: 10, fontSize: 13, color: "var(--ink-2, #555)" }}>
                    <span style={{ fontWeight: 600 }}>Согласие с политикой ПД:</span>{" "}
                    {u.consent_given_at
                      ? <span style={{ color: "var(--ok, #27ae60)" }}>✓ {fmtDateTime(u.consent_given_at)}</span>
                      : <span style={{ color: "var(--smoke, #888)" }}>не получено</span>
                    }
                  </div>
                );
              })()}

              <Row>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label className="label">Роль</label>
                  <select className="input" value={form.role} onChange={(e) => setFieldValue("role", e.target.value)}>
                    {ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <CheckboxField label="Активен" checked={form.is_active} onChange={(v) => setFieldValue("is_active", v)} />
              </Row>

              {(form.role === "driver" || form.role === "foreman") && (
                <Row>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label className="label">
                      Карточка водителя
                      {form.role === "foreman" && (
                        <span style={{ fontWeight: 400, color: "var(--ink-3)", marginLeft: 4 }}>(опционально — для перехода «← Водитель»)</span>
                      )}
                    </label>
                    <select
                      className="input"
                      value={form.driver_id}
                      onChange={(e) => setFieldValue("driver_id", e.target.value)}
                    >
                      <option value="">— выберите —</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </Row>
              )}

              <Row>
                <TextField
                  label={editingId ? "Новый пароль (оставьте пустым, если не меняете)" : "Пароль"}
                  type="password"
                  value={form.password}
                  onChange={(v) => setFieldValue("password", v)}
                />
              </Row>

              {formError && <p style={{ color: "var(--ember)", fontSize: 13, margin: "0 0 12px" }}>{formError}</p>}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  {editingId && (
                    <button
                      type="button"
                      className="pill-btn"
                      style={{ color: "var(--bad-ink)" }}
                      disabled={saving || editingId === me?.id}
                      onClick={handleDelete}
                    >
                      Удалить
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className="pill-btn" onClick={closeModal}>
                    Отмена
                  </button>
                  <button type="button" className="pill-btn solid" disabled={saving} onClick={handleSave}>
                    {saving ? "Сохранение..." : "Сохранить"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>{children}</div>;
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 160 }}>
      <label className="label">{label}</label>
      <input type={type} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="checkbox-row" style={{ flex: 1 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
