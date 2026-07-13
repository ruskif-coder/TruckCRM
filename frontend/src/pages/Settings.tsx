import { Fragment, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { api, ApiError } from "../api";
import Icon from "../components/Icon";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeContext";
import { UsersTable } from "./Users";

// Настройки — раздел админки с набором вкладок: «Профиль» (доступна всем
// ролям) и, только для admin, «Пользователи»/«Роли». «Перевозчики» отсюда
// перенесены в Справочники 2026-06-28 («перенеси перевозчики из настроек в
// справочники») — логически это справочник наравне с Автомобили/Водители,
// не настройка (см. Directories.tsx).
type TabId = "profile" | "users" | "roles" | "log" | "categories" | "counterparties";
const BASE_TABS: { id: TabId; label: string }[] = [
  { id: "profile", label: "Профиль" },
];
// «Пользователи» (2026-06-28, «наведём порядок») — бывший самостоятельный
// раздел /users, теперь вкладка здесь. Видна только админу - бэкенд
// всё равно гейтит /api/users на require_role("admin") (routers/users.py),
// но прятать саму вкладку от не-админа - не лишний UX-слой, раз уж раньше
// весь /users-роут был доступен только им же (AppShell.tsx: USERS_NAV_ITEM
// добавлялся в навигацию только при user.role === "admin").
const USERS_TAB: { id: TabId; label: string } = { id: "users", label: "Пользователи" };
// «Роли» (2026-06-28) — настройка доступа к разделам CRM для бригадира/
// бухгалтера/водителя (admin не настраивается - у него всегда полный
// доступ). Тоже только для админа - GET/PUT /api/role-permissions гейтятся
// require_role("admin") на бэкенде (routers/role_permissions.py), по тем же
// причинам, что и «Пользователи».
const ROLES_TAB: { id: TabId; label: string } = { id: "roles", label: "Роли" };
// «Журнал» (2026-06-28, «введём логирование действий пользователей») —
// журнал изменений (create/update/delete) по всем разделам + попытки входа,
// см. backend/app/audit.py. Тоже только для админа — GET /api/audit-log
// гейтится require_role("admin") на бэкенде (routers/audit_log.py), по тем
// же причинам, что и «Пользователи»/«Роли» (доступ к журналу — это тоже
// управление безопасностью, не операционная зона).
const LOG_TAB: { id: TabId; label: string } = { id: "log", label: "Журнал" };
// «Статьи расходов» (2026-07-04) — справочник статей ExpenseCategory с
// настройкой доступа по ролям. Только для admin (бэкенд гейтит POST/PUT/DELETE).
const CATEGORIES_TAB: { id: TabId; label: string } = { id: "categories", label: "Статьи" };
// «Контрагенты» (2026-07-12) — справочник контрагентов (Название, ИНН, НДС%).
// Только для admin — GET /api/counterparties/ открыт всем залогиненным, но
// редактирование (POST/PUT/DELETE) гейтится require_role("admin") на бэкенде.
const COUNTERPARTIES_TAB: { id: TabId; label: string } = { id: "counterparties", label: "Контрагенты" };

export default function Settings() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabId>("profile");
  const tabs = user?.role === "admin" ? [...BASE_TABS, USERS_TAB, ROLES_TAB, LOG_TAB, CATEGORIES_TAB, COUNTERPARTIES_TAB] : BASE_TABS;

  // 2026-06-28 («выровнять вкладки и кнопки в одну строку») - переключатель
  // вкладок передаётся вниз каждой вкладке как tabsNav, а не рисуется здесь
  // отдельной строкой - так он встаёт в одну строку с кнопкой действия самой
  // вкладки (например «Добавить перевозчика»), не тратя лишнюю высоту.
  const tabsNav = (
    <div className="navpills" style={{ width: "fit-content" }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={"navpill" + (tab === t.id ? " active" : "")}
          style={{ border: "none", background: tab === t.id ? undefined : "none", cursor: "pointer", font: "inherit" }}
          onClick={() => setTab(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <div className="pagehead">
        <div className="ph-title">
          <div className="crumbs">
            <Icon name="grid" size={13} /> Автопарк <Icon name="chevr" size={13} /> Настройки
          </div>
          <h1 className="pagetitle">Настройки</h1>
        </div>
      </div>

      <div key={tab} className="tab-panel">
        {tab === "profile" && <ProfileTab tabsNav={tabsNav} />}
        {tab === "users" && user?.role === "admin" && <UsersTable tabsNav={tabsNav} />}
        {tab === "roles" && user?.role === "admin" && <RolesTab tabsNav={tabsNav} />}
        {tab === "log" && user?.role === "admin" && <LogTab tabsNav={tabsNav} />}
        {tab === "categories" && user?.role === "admin" && <CategoriesTab tabsNav={tabsNav} />}
        {tab === "counterparties" && user?.role === "admin" && <CounterpartiesTab tabsNav={tabsNav} />}
      </div>
    </div>
  );
}

function ProfileTab({ tabsNav }: { tabsNav?: ReactNode }) {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <div style={{ marginBottom: 16 }}>{tabsNav}</div>
      <div className="fcard" style={{ maxWidth: 480 }}>
        <SectionLabel>Учётная запись</SectionLabel>
      <Row>
        <div style={{ flex: 1 }}>
          <div className="label">ФИО</div>
          <div style={{ fontWeight: 600 }}>{user?.full_name || "—"}</div>
        </div>
      </Row>
      <Row>
        <div style={{ flex: 1 }}>
          <div className="label">Логин</div>
          <div style={{ fontWeight: 600 }}>{user?.username || "—"}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div className="label">Роль</div>
          <div style={{ fontWeight: 600 }}>{user?.role || "—"}</div>
        </div>
      </Row>

      <SectionLabel>Тема оформления</SectionLabel>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className={"pill-btn" + (theme === "light" ? " solid" : "")}
          onClick={() => setTheme("light")}
        >
          Светлая
        </button>
        <button
          type="button"
          className={"pill-btn" + (theme === "dark" ? " solid" : "")}
          onClick={() => setTheme("dark")}
        >
          Тёмная
        </button>
      </div>
      </div>
    </div>
  );
}

// «Роли» (2026-06-28) — таблица зона×роль с бэкенда (GET/PUT /api/role-permissions,
// см. routers/role_permissions.py и permissions.py). Зоны и роли в строках уже
// идут в стабильном порядке с бэкенда (ZONES × CONFIGURABLE_ROLES) - просто
// разворачиваем уникальные подписи в порядке появления, не пересортировываем.
type RolePermissionRow = {
  zone: string;
  zone_label: string;
  role: string;
  role_label: string;
  can_read: boolean;
  can_write: boolean;
  write_applicable: boolean;
};

function RolesTab({ tabsNav }: { tabsNav?: ReactNode }) {
  const [matrix, setMatrix] = useState<RolePermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const rows = await api.get<RolePermissionRow[]>("/api/role-permissions/");
      setMatrix(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const zones: { zone: string; label: string; writeApplicable: boolean }[] = [];
  const roles: { role: string; label: string }[] = [];
  const seenZones = new Set<string>();
  const seenRoles = new Set<string>();
  for (const row of matrix) {
    if (!seenZones.has(row.zone)) {
      seenZones.add(row.zone);
      zones.push({ zone: row.zone, label: row.zone_label, writeApplicable: row.write_applicable });
    }
    if (!seenRoles.has(row.role)) {
      seenRoles.add(row.role);
      roles.push({ role: row.role, label: row.role_label });
    }
  }
  const cellMap = new Map<string, RolePermissionRow>();
  for (const row of matrix) cellMap.set(`${row.zone}:${row.role}`, row);

  function toggle(zone: string, role: string, field: "can_read" | "can_write") {
    setSaved(false);
    setMatrix((prev) => prev.map((r) => (r.zone === zone && r.role === role ? { ...r, [field]: !r[field] } : r)));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.put("/api/role-permissions/", {
        items: matrix.map((r) => ({ zone: r.zone, role: r.role, can_read: r.can_read, can_write: r.can_write })),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabsNav}
        <button className="pill-btn solid" disabled={saving || loading} onClick={handleSave}>
          {saving ? "Сохранение..." : saved ? "Сохранено" : "Сохранить"}
        </button>
      </div>

      <p style={{ color: "var(--ink-3)", fontSize: 13, margin: "0 0 16px", maxWidth: 720 }}>
        Доступ к разделам для ролей «Бригадир», «Бухгалтер» и «Водитель» — у admin полный доступ всегда, независимо
        от этой таблицы. Разделы «Пользователи», «Настройки», «Условия оплаты» и «Партии рейсов» в таблицу не
        входят и остаются доступны только admin, чтобы роль не могла выдать себе доступ к управлению ролями через
        эту же страницу.
      </p>

      {error && (
        <p className="fcard" style={{ color: "var(--ember)", marginBottom: 24 }}>
          {error}
        </p>
      )}

      <div className="fcard" style={{ padding: 0 }}>
        {loading ? (
          <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>Загрузка...</p>
        ) : (
          <div className="tbl-scroll" style={{ padding: "16px 20px" }}>
            <table>
              <thead>
                <tr>
                  <th rowSpan={2} style={{ verticalAlign: "bottom" }}>
                    Раздел
                  </th>
                  {roles.map((r) => (
                    <th key={r.role} colSpan={2} style={{ textAlign: "center" }}>
                      {r.label}
                    </th>
                  ))}
                </tr>
                <tr>
                  {roles.map((r) => (
                    <Fragment key={r.role}>
                      <th style={{ textAlign: "center", fontWeight: 400, color: "var(--ink-3)" }}>Чтение</th>
                      <th style={{ textAlign: "center", fontWeight: 400, color: "var(--ink-3)" }}>Запись</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.zone}>
                    <td>{z.label}</td>
                    {roles.map((r) => {
                      const cell = cellMap.get(`${z.zone}:${r.role}`);
                      return (
                        <Fragment key={r.role}>
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={!!cell?.can_read}
                              onChange={() => toggle(z.zone, r.role, "can_read")}
                            />
                          </td>
                          <td style={{ textAlign: "center" }}>
                            {z.writeApplicable ? (
                              <input
                                type="checkbox"
                                checked={!!cell?.can_write}
                                onChange={() => toggle(z.zone, r.role, "can_write")}
                              />
                            ) : (
                              <span style={{ color: "var(--ink-3)" }}>—</span>
                            )}
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// «Журнал» (2026-06-28) — таблица записей с бэкенда (GET /api/audit-log/,
// см. routers/audit_log.py и app/audit.py). changes_json хранит полную
// историю по полям ({field: {old, new}}, плюс служебный ключ "_extra" для
// сводок bulk-операций типа импорта) — разворачивается по клику на строку,
// чтобы таблица сама оставалась компактной.
type ActionLogEntry = {
  id: number;
  created_at: string;
  user_id: number | null;
  username: string;
  role: string;
  action: string;
  zone: string;
  entity_id: number | null;
  summary: string;
  changes_json: string;
};

type MetaOption = { value: string; label: string };

function formatLogDateTime(iso: string): string {
  // created_at приходит как наивный UTC datetime (datetime.utcnow() в
  // models.ActionLog, без таймзоны в строке) - дописываем "Z" перед
  // парсингом, иначе `new Date()` принял бы его за локальное время и сдвиг
  // зависел бы от часового пояса браузера.
  const withZone = /[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(withZone);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatLogValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function LogTab({ tabsNav }: { tabsNav?: ReactNode }) {
  const [entries, setEntries] = useState<ActionLogEntry[]>([]);
  const [zones, setZones] = useState<MetaOption[]>([]);
  const [actions, setActions] = useState<MetaOption[]>([]);
  const [zoneFilter, setZoneFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    api
      .get<{ zones: MetaOption[]; actions: MetaOption[] }>("/api/audit-log/meta")
      .then((meta) => {
        setZones(meta.zones);
        setActions(meta.actions);
      })
      .catch(() => {
        /* фильтры необязательны — без подписей таблица всё равно работает */
      });
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (zoneFilter) params.set("zone", zoneFilter);
      if (actionFilter) params.set("action", actionFilter);
      const qs = params.toString();
      const rows = await api.get<ActionLogEntry[]>(`/api/audit-log/${qs ? `?${qs}` : ""}`);
      setEntries(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneFilter, actionFilter]);

  function zoneLabel(z: string): string {
    return zones.find((o) => o.value === z)?.label || z;
  }
  function actionLabel(a: string): string {
    return actions.find((o) => o.value === a)?.label || a;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabsNav}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select className="input" value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">Все разделы</option>
            {zones.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </select>
          <select className="input" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">Все действия</option>
            {actions.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="fcard" style={{ color: "var(--ember)", marginBottom: 24 }}>
          {error}
        </p>
      )}

      <div className="fcard" style={{ padding: 0 }}>
        {loading ? (
          <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>Загрузка...</p>
        ) : entries.length === 0 ? (
          <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>Записей пока нет.</p>
        ) : (
          <div className="tbl-scroll" style={{ padding: "16px 20px" }}>
            <table>
              <thead>
                <tr>
                  <th>Дата и время</th>
                  <th>Пользователь</th>
                  <th>Действие</th>
                  <th>Раздел</th>
                  <th>Запись</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  let changes: Record<string, { old: unknown; new: unknown }> = {};
                  try {
                    changes = e.changes_json ? JSON.parse(e.changes_json) : {};
                  } catch {
                    changes = {};
                  }
                  const fieldChanges = Object.entries(changes).filter(([k]) => k !== "_extra");
                  const extra = changes["_extra"]?.new as Record<string, unknown> | undefined;
                  const expanded = expandedId === e.id;
                  const hasDetails = fieldChanges.length > 0 || !!extra;
                  return (
                    <Fragment key={e.id}>
                      <tr
                        style={{ cursor: hasDetails ? "pointer" : "default" }}
                        onClick={() => hasDetails && setExpandedId(expanded ? null : e.id)}
                      >
                        <td style={{ whiteSpace: "nowrap" }}>{formatLogDateTime(e.created_at)}</td>
                        <td>{e.username || "—"}</td>
                        <td>{actionLabel(e.action)}</td>
                        <td>{zoneLabel(e.zone)}</td>
                        <td>
                          {e.summary}
                          {hasDetails && (
                            <span style={{ color: "var(--ink-3)", marginLeft: 6 }}>{expanded ? "▲" : "▼"}</span>
                          )}
                        </td>
                      </tr>
                      {expanded && hasDetails && (
                        <tr>
                          <td colSpan={5} style={{ background: "var(--panel-2, rgba(0,0,0,.02))" }}>
                            <div style={{ padding: "8px 4px", fontSize: 13 }}>
                              {fieldChanges.map(([field, { old, new: nv }]) => (
                                <div key={field} style={{ marginBottom: 4 }}>
                                  <span style={{ color: "var(--ink-3)" }}>{field}: </span>
                                  {formatLogValue(old)} → {formatLogValue(nv)}
                                </div>
                              ))}
                              {extra && (
                                <div>
                                  {Object.entries(extra).map(([k, v]) => (
                                    <span key={k} style={{ marginRight: 16 }}>
                                      <span style={{ color: "var(--ink-3)" }}>{k}: </span>
                                      {formatLogValue(v)}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>{children}</div>;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".04em", margin: "0 0 12px" }}>
      {children}
    </p>
  );
}

// ─── Статьи расходов (2026-07-04) ─────────────────────────────────────────
// Управление справочником ExpenseCategory: имя, активность, порядок, роли.
type ExpCat = { id: number; name: string; allowed_roles: string; active: boolean; sort_order: number };
const ALL_ROLES = ["driver", "foreman", "accountant"];
const ROLE_LABELS: Record<string, string> = { driver: "Водитель", foreman: "Бригадир", accountant: "Бухгалтер" };

function parseRoles(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

function CategoriesTab({ tabsNav }: { tabsNav?: ReactNode }) {
  const [cats, setCats] = useState<ExpCat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // id → true пока идёт сохранение этой строки (любое поле)
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  // Форма добавления новой статьи
  const [addName, setAddName] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Инлайн-редактирование имени
  const [editNameId, setEditNameId] = useState<number | null>(null);
  const [editNameVal, setEditNameVal] = useState("");

  // Drag-and-drop сортировка строк
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setCats(await api.get<ExpCat[]>("/api/expense-categories/")); }
    catch { setError("Ошибка загрузки"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  // Мгновенное сохранение поля(ей) одной строки
  async function patchCat(c: ExpCat, patch: Partial<ExpCat>) {
    const updated = { ...c, ...patch };
    const roles = parseRoles(updated.allowed_roles);
    setSaving(prev => ({ ...prev, [c.id]: true }));
    try {
      await api.put(`/api/expense-categories/${c.id}`, {
        name: updated.name,
        allowed_roles: roles,
        active: updated.active,
        sort_order: updated.sort_order,
      });
      setCats(prev => prev.map(x => x.id === c.id ? { ...x, ...patch } : x));
    } catch { /* тихий провал — UI не меняется */ }
    finally { setSaving(prev => ({ ...prev, [c.id]: false })); }
  }

  async function toggleRole(c: ExpCat, role: string, checked: boolean) {
    const roles = parseRoles(c.allowed_roles);
    const next = checked ? [...roles, role] : roles.filter(r => r !== role);
    // Оптимистичное обновление UI
    setCats(prev => prev.map(x => x.id === c.id ? { ...x, allowed_roles: JSON.stringify(next) } : x));
    await patchCat({ ...c, allowed_roles: JSON.stringify(next) }, {});
  }

  async function handleAdd() {
    if (!addName.trim()) { setAddError("Введите название"); return; }
    setAddSaving(true); setAddError(null);
    try {
      await api.post("/api/expense-categories/", {
        name: addName.trim(),
        allowed_roles: ALL_ROLES,
        active: true,
        sort_order: cats.length,
      });
      setAddName("");
      await load();
    } catch (e) { setAddError(e instanceof ApiError ? e.message : "Ошибка"); }
    finally { setAddSaving(false); }
  }

  async function saveName(c: ExpCat) {
    if (editNameVal.trim() && editNameVal.trim() !== c.name) {
      await patchCat(c, { name: editNameVal.trim() });
    }
    setEditNameId(null);
  }

  async function handleDrop(targetId: number) {
    if (dragId === null || dragId === targetId) return;
    const from = cats.findIndex(c => c.id === dragId);
    const to = cats.findIndex(c => c.id === targetId);
    if (from === -1 || to === -1) return;

    const next = [...cats];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);

    const withOrders = next.map((c, i) => ({ ...c, sort_order: i }));
    const originalOrders = new Map(cats.map(c => [c.id, c.sort_order]));
    setCats(withOrders);
    setDragId(null);
    setDragOverId(null);

    // Сохраняем только изменившиеся sort_order
    for (const c of withOrders) {
      if (originalOrders.get(c.id) !== c.sort_order) {
        patchCat(c, {}).catch(() => {});
      }
    }
  }

  const thCat: CSSProperties = {
    padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600,
    color: "var(--smoke)", background: "var(--bg, #f5f5f9)",
    borderBottom: "1px solid var(--border, #ebebef)", whiteSpace: "nowrap",
  };
  const thRole: CSSProperties = {
    ...thCat, textAlign: "center", minWidth: 88,
  };
  const tdName: CSSProperties = {
    padding: "10px 14px", fontSize: 13,
    borderBottom: "1px solid var(--border, #ebebef)",
  };
  const tdCenter: CSSProperties = {
    padding: "10px 14px", textAlign: "center",
    borderBottom: "1px solid var(--border, #ebebef)",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabsNav}
      </div>

      {/* Форма добавления — одна строка */}
      <div style={{ marginBottom: addError ? 4 : 16, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          className="input"
          value={addName}
          onChange={e => { setAddName(e.target.value); setAddError(null); }}
          placeholder="Новая статья..."
          onKeyDown={e => e.key === "Enter" && handleAdd()}
          style={{ maxWidth: 320 }}
        />
        <button className="pill-btn solid" onClick={handleAdd} disabled={addSaving} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
          {addSaving ? "..." : "+ Добавить"}
        </button>
      </div>
      {addError && <p style={{ color: "var(--ember)", fontSize: 12, margin: "0 0 12px" }}>{addError}</p>}

      {error && <p style={{ color: "var(--ember)", marginBottom: 12 }}>{error}</p>}

      {loading ? (
        <div className="fcard" style={{ textAlign: "center", color: "var(--smoke)", padding: "32px 0" }}>Загрузка...</div>
      ) : (
        <div className="fcard" style={{ padding: 0, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thCat, width: 32, padding: "10px 8px", textAlign: "center" }} title="Перетащить для изменения порядка">⠿</th>
                <th style={thCat}>Статья</th>
                {ALL_ROLES.map(r => (
                  <th key={r} style={thRole}>{ROLE_LABELS[r]}</th>
                ))}
                <th style={{ ...thCat, textAlign: "center" }}>Активна</th>
              </tr>
            </thead>
            <tbody>
              {cats.map(c => {
                const roles = parseRoles(c.allowed_roles);
                const isSaving = !!saving[c.id];
                const isDragOver = dragOverId === c.id && dragId !== c.id;
                return (
                  <tr
                    key={c.id}
                    draggable
                    onDragStart={() => setDragId(c.id)}
                    onDragOver={e => { e.preventDefault(); setDragOverId(c.id); }}
                    onDrop={() => handleDrop(c.id)}
                    onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                    style={{
                      opacity: isSaving ? 0.6 : dragId === c.id ? 0.4 : 1,
                      transition: "opacity .15s",
                      outline: isDragOver ? "2px solid var(--iris)" : undefined,
                      outlineOffset: isDragOver ? "-2px" : undefined,
                    }}
                  >
                    {/* Ручка перетаскивания */}
                    <td style={{ ...tdCenter, width: 32, padding: "10px 8px", cursor: "grab", color: "var(--smoke)", fontSize: 17, userSelect: "none" }}>
                      ⠿
                    </td>
                    {/* Название — двойной клик для редактирования */}
                    <td style={{ ...tdName, color: c.active ? undefined : "var(--smoke)" }}>
                      {editNameId === c.id ? (
                        <input
                          className="input"
                          autoFocus
                          value={editNameVal}
                          onChange={e => setEditNameVal(e.target.value)}
                          onBlur={() => saveName(c)}
                          onKeyDown={e => {
                            if (e.key === "Enter") saveName(c);
                            if (e.key === "Escape") setEditNameId(null);
                          }}
                          style={{ minWidth: 140 }}
                        />
                      ) : (
                        <span
                          title="Двойной клик — изменить"
                          style={{ cursor: "text" }}
                          onDoubleClick={() => { setEditNameId(c.id); setEditNameVal(c.name); }}
                        >
                          {c.name}
                        </span>
                      )}
                    </td>
                    {/* Чекбоксы ролей — мгновенное сохранение */}
                    {ALL_ROLES.map(r => (
                      <td key={r} style={tdCenter}>
                        <input
                          type="checkbox"
                          checked={roles.includes(r)}
                          disabled={isSaving}
                          onChange={e => toggleRole(c, r, e.target.checked)}
                          style={{ width: 16, height: 16, accentColor: "var(--iris)", cursor: "pointer" }}
                        />
                      </td>
                    ))}
                    {/* Активна */}
                    <td style={tdCenter}>
                      <input
                        type="checkbox"
                        checked={c.active}
                        disabled={isSaving}
                        onChange={e => patchCat(c, { active: e.target.checked })}
                        style={{ width: 16, height: 16, accentColor: "var(--iris)", cursor: "pointer" }}
                        title={c.active ? "Отключить статью" : "Включить статью"}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: "var(--smoke)", padding: "8px 14px", margin: 0 }}>
            Перетащите строку за ⠿ чтобы изменить порядок. Двойной клик по названию — изменить. Все изменения сохраняются мгновенно.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Контрагенты (2026-07-12) ──────────────────────────────────────────────
// CRUD для справочника контрагентов: Название, ИНН, НДС%. Только admin.
type Counterparty = { id: number; name: string; inn: string; vat_rate: number };

function CounterpartiesTab({ tabsNav }: { tabsNav?: ReactNode }) {
  const [items, setItems] = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Форма добавления
  const [addName, setAddName] = useState("");
  const [addInn, setAddInn] = useState("");
  const [addVat, setAddVat] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Инлайн-редактирование
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editInn, setEditInn] = useState("");
  const [editVat, setEditVat] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try { setItems(await api.get<Counterparty[]>("/api/counterparties/")); }
    catch { setError("Ошибка загрузки"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function startEdit(c: Counterparty) {
    setEditId(c.id);
    setEditName(c.name);
    setEditInn(c.inn || "");
    setEditVat(c.vat_rate != null ? String(c.vat_rate) : "0");
  }

  async function saveEdit() {
    if (!editId) return;
    setEditSaving(true);
    try {
      await api.put(`/api/counterparties/${editId}`, {
        name: editName.trim() || undefined,
        inn: editInn,
        vat_rate: Number(editVat) || 0,
      });
      setEditId(null);
      await load();
    } catch { /* тихий провал */ }
    finally { setEditSaving(false); }
  }

  async function handleAdd() {
    if (!addName.trim()) { setAddError("Введите название"); return; }
    setAddSaving(true); setAddError(null);
    try {
      await api.post("/api/counterparties/", {
        name: addName.trim(),
        inn: addInn,
        vat_rate: Number(addVat) || 0,
      });
      setAddName(""); setAddInn(""); setAddVat("");
      await load();
    } catch (e) { setAddError(e instanceof ApiError ? e.message : "Ошибка"); }
    finally { setAddSaving(false); }
  }

  async function handleDelete(id: number, name: string) {
    if (!window.confirm(`Удалить контрагента «${name}»?`)) return;
    try {
      await api.delete(`/api/counterparties/${id}`);
      await load();
    } catch { /* тихий провал */ }
  }

  const thC: CSSProperties = {
    padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600,
    color: "var(--smoke)", background: "var(--bg, #f5f5f9)",
    borderBottom: "1px solid var(--border, #ebebef)", whiteSpace: "nowrap",
  };
  const tdC: CSSProperties = {
    padding: "8px 14px", fontSize: 13,
    borderBottom: "1px solid var(--border, #ebebef)", verticalAlign: "middle",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabsNav}
      </div>

      {/* Форма добавления */}
      <div style={{ marginBottom: addError ? 4 : 16, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label className="label">Название</label>
          <input
            className="input"
            value={addName}
            onChange={e => { setAddName(e.target.value); setAddError(null); }}
            placeholder="ООО Ромашка..."
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            style={{ minWidth: 240 }}
          />
        </div>
        <div>
          <label className="label">ИНН</label>
          <input
            className="input"
            value={addInn}
            onChange={e => setAddInn(e.target.value)}
            placeholder="7700000000"
            style={{ minWidth: 140 }}
          />
        </div>
        <div>
          <label className="label">НДС, %</label>
          <input
            className="input"
            type="number"
            value={addVat}
            onChange={e => setAddVat(e.target.value)}
            placeholder="0"
            style={{ minWidth: 80 }}
          />
        </div>
        <button className="pill-btn solid" onClick={handleAdd} disabled={addSaving} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
          {addSaving ? "..." : "+ Добавить"}
        </button>
      </div>
      {addError && <p style={{ color: "var(--ember)", fontSize: 12, margin: "0 0 12px" }}>{addError}</p>}

      {error && <p style={{ color: "var(--ember)", marginBottom: 12 }}>{error}</p>}

      {loading ? (
        <div className="fcard" style={{ textAlign: "center", color: "var(--smoke)", padding: "32px 0" }}>Загрузка...</div>
      ) : items.length === 0 ? (
        <div className="fcard" style={{ textAlign: "center", color: "var(--smoke)", padding: "32px 0" }}>Контрагентов пока нет. Добавьте первого выше.</div>
      ) : (
        <div className="fcard" style={{ padding: 0, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thC}>Название</th>
                <th style={thC}>ИНН</th>
                <th style={{ ...thC, textAlign: "right" }}>НДС, %</th>
                <th style={{ ...thC, width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map(c => (
                <tr key={c.id}>
                  {editId === c.id ? (
                    <>
                      <td style={tdC}>
                        <input
                          className="input"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          style={{ width: "100%", minWidth: 160 }}
                          autoFocus
                        />
                      </td>
                      <td style={tdC}>
                        <input
                          className="input"
                          value={editInn}
                          onChange={e => setEditInn(e.target.value)}
                          style={{ width: "100%", minWidth: 120 }}
                        />
                      </td>
                      <td style={{ ...tdC, textAlign: "right" }}>
                        <input
                          className="input"
                          type="number"
                          value={editVat}
                          onChange={e => setEditVat(e.target.value)}
                          style={{ width: 80, textAlign: "right" }}
                        />
                      </td>
                      <td style={{ ...tdC, whiteSpace: "nowrap" }}>
                        <button className="pill-btn solid" onClick={saveEdit} disabled={editSaving} style={{ fontSize: 12, padding: "4px 10px", marginRight: 4 }}>
                          {editSaving ? "..." : "✓"}
                        </button>
                        <button className="pill-btn" onClick={() => setEditId(null)} style={{ fontSize: 12, padding: "4px 10px" }}>✕</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={tdC}>{c.name}</td>
                      <td style={{ ...tdC, color: "var(--smoke)" }}>{c.inn || "—"}</td>
                      <td style={{ ...tdC, textAlign: "right" }}>{c.vat_rate != null && c.vat_rate > 0 ? `${c.vat_rate}%` : "—"}</td>
                      <td style={{ ...tdC, whiteSpace: "nowrap" }}>
                        <button
                          className="pill-btn"
                          onClick={() => startEdit(c)}
                          style={{ fontSize: 12, padding: "4px 10px", marginRight: 4 }}
                          title="Редактировать"
                        >
                          ✎
                        </button>
                        <button
                          className="pill-btn"
                          onClick={() => handleDelete(c.id, c.name)}
                          style={{ fontSize: 12, padding: "4px 10px", color: "var(--ember)" }}
                          title="Удалить"
                        >
                          ✕
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
