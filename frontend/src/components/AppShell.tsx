// Глобальная навигационная оболочка — рейл + топбар + хедер страницы + мобильная
// нижняя навигация. Портировано из design_handoff_fleet_dashboard/STARTER_TSX.md
// и расширено до 6 разделов (вместо 3 в макете) по решению пользователя.
//
// Общий блок-хедер (крошки + крупный заголовок + кнопки поиска/фильтра/добавить)
// рендерится здесь только для «Демо-дашборд» (через META ниже) — у всех
// остальных разделов (включая «Дашборд», переведённый на свой пейджхед с
// рабочим выбором дат 2026-06-26, и «Автомобили», переведённые на настоящий
// CRUD 2026-06-23) хедер того же визуального стиля (.pagehead/.pill-btn), но
// со своими кнопками-действиями, поэтому каждая страница рисует его сама
// внутри своего JSX, а не через META/Outlet.
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../theme/ThemeContext";
import Icon, { type IconName } from "./Icon";

// Порядок и состав разделов наведён в порядок 2026-06-28 («наведём порядок»):
// Дашборд/Отчёты идут первой парой, Автомобили+Водители объединены в один
// пункт «Справочники» (см. pages/Directories.tsx), Топливо стало вкладкой
// внутри Расходов (см. pages/Expenses.tsx), Пользователи стали вкладкой
// внутри Настроек (см. pages/Settings.tsx) - поэтому ни «Топливо», ни
// «Пользователи», ни отдельных «Автомобили»/«Водители» здесь больше нет.
//
// roles?: если задан — только перечисленные роли видят пункт.
// Нет roles — виден всем авторизованным (кроме driver, которых до AppShell
// не пускает редирект ниже). 2026-07-07: скрываем от бригадира Отчёты,
// Настройки и Демо-дашборд; Настройки — только admin.
// zones?: видимость определяется динамически через GET /api/auth/my-zones
//         (RolePermission), могут быть несколько зон — достаточно одной
//         доступной. Без zones — видно всем.
// roles?: статическая фильтрация для разделов вне матрицы (Настройки,
//         Отчёты, Демо) — определяется прямо здесь, не через БД.
// 2026-07-07: Ремонт → иконка wrench; Настройки → cog; динамика через zones.
const NAV: { to: string; label: string; icon: IconName; roles?: string[]; zones?: string[] }[] = [
  { to: "/", label: "Дашборд", icon: "grid", zones: ["dashboard"] },
  { to: "/reports", label: "Отчёты", icon: "list", roles: ["admin", "manager", "accountant"] },
  { to: "/directory", label: "Справочники", icon: "folder", zones: ["trucks", "drivers"] },
  { to: "/trips", label: "Рейсы", icon: "route", zones: ["trips"] },
  { to: "/expenses", label: "Финансы", icon: "doc", zones: ["expenses"] },
  { to: "/repairs", label: "Ремонт", icon: "wrench", zones: ["repair_requests"] },
  { to: "/settings", label: "Настройки", icon: "cog", roles: ["admin"] },
];

const META: Record<string, { title: string; crumb: string }> = {};

type UserRow = { id: number; username: string; full_name: string | null; role: string };

type ExpiryItem = {
  entity_type: "truck" | "driver";
  entity_id: number;
  entity_label: string;
  doc_type: string;
  expiry_date: string;
  days_left: number;
  level: "expired" | "critical" | "warn" | "notice";
};

function expiryLabel(days: number): string {
  if (days < 0) return `просрочено ${Math.abs(days)} дн. назад`;
  if (days === 0) return "истекает сегодня";
  if (days < 30) return `через ${days} дн.`;
  return `через ${Math.round(days / 30)} мес.`;
}

const EXPIRY_COLOR: Record<string, string> = {
  expired: "#e74c3c",
  critical: "#e74c3c",
  warn: "#d99a3a",
  notice: "#7a8fa6",
};

function initials(u: UserRow) {
  const name = u.full_name || u.username;
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  driver: "Водитель",
  foreman: "Бригадир",
  staff: "Сотрудник",
};

// Общий стиль всплывающих панелей
const popupStyle: CSSProperties = {
  position: "absolute",
  top: "calc(100% + 8px)",
  right: 0,
  zIndex: 400,
  background: "var(--card)",
  border: "1px solid var(--edge)",
  borderRadius: 14,
  boxShadow: "0 8px 32px rgba(0,0,0,0.13)",
  minWidth: 220,
  maxWidth: "calc(100vw - 16px)",
  animation: "fadeIn 0.16s ease-out",
};

export default function AppShell() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const meta = META[pathname];

  // Счётчик открытых заявок на ремонт — показывается как бейдж на пункте «Ремонт».
  const [openCount, setOpenCount] = useState(0);
  // Счётчик заявок на компенсацию «на рассмотрении» — бейдж на пункте «Расходы».
  const [compPendingCount, setCompPendingCount] = useState(0);
  // Документы с истекающим сроком действия
  const [expiryItems, setExpiryItems] = useState<ExpiryItem[]>([]);
  // Доступные зоны текущего пользователя (из RolePermission). null = загрузка.
  // admin и роли вне матрицы получают все зоны; driver не доходит до AppShell.
  const [myZones, setMyZones] = useState<string[] | null>(null);

  // Пользователи, активные в последние 30 мин — только для admin, блок "Сейчас в системе"
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);

  // Состояния всплывающих панелей
  const [showUsers, setShowUsers] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const usersRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<{ count: number }>("/api/repair-requests/open-count/")
      .then(d => setOpenCount(d.count))
      .catch(() => {});
    api.get<{ count: number }>("/api/compensation-requests/pending-count/")
      .then(d => setCompPendingCount(d.count))
      .catch(() => {});
    api.get<{ items: ExpiryItem[]; total: number; critical_count: number }>("/api/dashboard/expiring-docs")
      .then(d => setExpiryItems(d.items))
      .catch(() => {});
  }, []);

  // Загружаем зоны доступа для фильтрации меню. admin видит всё — запрос
  // не нужен (setMyZones остаётся null, visibleNav ниже покажет всё).
  // 2026-07-07.
  useEffect(() => {
    if (user?.role && user.role !== "admin" && user.role !== "driver") {
      api.get<{ zones: string[] }>("/api/auth/my-zones")
        .then(d => setMyZones(d.zones))
        .catch(() => setMyZones([]));
    }
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== "admin") return;
    // Загружаем пользователей, активных в последние 30 минут (2026-07-07)
    const loadOnline = () => {
      api.get<UserRow[]>("/api/users/online/")
        .then(setAllUsers)
        .catch(() => {});
    };
    loadOnline();
    const timer = setInterval(loadOnline, 30_000);
    return () => clearInterval(timer);
  }, [user?.role]);

  // Закрывать панели при клике вне них
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (usersRef.current && !usersRef.current.contains(t)) setShowUsers(false);
      if (notifRef.current && !notifRef.current.contains(t)) setShowNotif(false);
      if (profileRef.current && !profileRef.current.contains(t)) setShowProfile(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Водители работают через мобильный дашборд (/driver), а не через эту оболочку.
  if (user?.role === "driver") {
    return <Navigate to="/driver" replace />;
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const initial = (user?.full_name || user?.username || "Я").trim().charAt(0).toUpperCase();

  // Аватары: первые 3 пользователя (кроме текущего) + счётчик остальных
  const otherUsers = allUsers.filter(u => u.id !== user?.id);
  const avatarUsers = otherUsers.slice(0, 3);
  const moreCount = Math.max(0, otherUsers.length - 3);

  const hasNotif = openCount > 0 || compPendingCount > 0 || expiryItems.length > 0;

  // Фильтрация навигационного меню. 2026-07-07.
  // • zones (динамика): видно, если хотя бы одна зона из списка доступна
  //   для чтения текущему пользователю (данные из /api/auth/my-zones).
  //   Пока myZones === null (загрузка) — оптимистично показываем всё.
  //   admin → myZones не загружается, zones-пункты видны всегда.
  // • roles (статика): жёстко зашитые ограничения для разделов вне матрицы
  //   (Отчёты, Настройки, Демо-дашборд).
  const visibleNav = NAV.filter(n => {
    if (n.zones) {
      if (user?.role === "admin") return true;
      if (myZones === null) return true; // оптимистично, ждём ответ
      return n.zones.some(z => myZones.includes(z));
    }
    // Только roles (нет zones) — статический фильтр
    return !n.roles || n.roles.includes(user?.role ?? "");
  });

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">А</div>
        {visibleNav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            title={n.label}
            className={({ isActive }) => "rail-btn" + (isActive ? " active" : "")}
            style={{ position: "relative" }}
          >
            <Icon name={n.icon} size={21} />
            {n.to === "/repairs" && openCount > 0 && (
              <span style={{
                position: "absolute", top: 4, right: 4,
                background: "#e74c3c", color: "#fff",
                borderRadius: "50%", fontSize: 9, fontWeight: 700,
                width: 14, height: 14, lineHeight: "14px",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {openCount > 9 ? "9+" : openCount}
              </span>
            )}
            {n.to === "/expenses" && compPendingCount > 0 && (
              <span style={{
                position: "absolute", top: 4, right: 4,
                background: "#d99a3a", color: "#fff",
                borderRadius: "50%", fontSize: 9, fontWeight: 700,
                width: 14, height: 14, lineHeight: "14px",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {compPendingCount > 9 ? "9+" : compPendingCount}
              </span>
            )}
          </NavLink>
        ))}
        <div className="rail-spacer" />
        <button
          className="rail-btn"
          title={theme === "light" ? "Тёмная тема" : "Светлая тема"}
          onClick={toggleTheme}
        >
          {theme === "light" ? "🌙" : "☀️"}
        </button>
      </aside>

      <main className="main">
        <div className="topbar">
          <nav className="navpills">
            {visibleNav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) => "navpill" + (isActive ? " active" : "")}
              >
                <Icon name={n.icon} size={18} /> {n.label}
                {n.to === "/repairs" && openCount > 0 && (
                  <span style={{
                    marginLeft: 4,
                    background: "#e74c3c", color: "#fff",
                    borderRadius: 8, fontSize: 10, fontWeight: 700,
                    padding: "0 5px", lineHeight: "16px",
                    display: "inline-block", verticalAlign: "middle",
                  }}>
                    {openCount > 9 ? "9+" : openCount}
                  </span>
                )}
                {n.to === "/expenses" && compPendingCount > 0 && (
                  <span style={{
                    marginLeft: 4,
                    background: "#d99a3a", color: "#fff",
                    borderRadius: 8, fontSize: 10, fontWeight: 700,
                    padding: "0 5px", lineHeight: "16px",
                    display: "inline-block", verticalAlign: "middle",
                  }}>
                    {compPendingCount > 9 ? "9+" : compPendingCount}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="tb-spacer" />

          {/* ── Аватары пользователей (admin-only) ── */}
          {user?.role === "admin" && allUsers.length > 0 && (
            <div ref={usersRef} style={{ position: "relative" }} className="desk-only">
              <div
                className="avatars"
                onClick={() => { setShowUsers(v => !v); setShowNotif(false); setShowProfile(false); }}
                style={{ cursor: "pointer" }}
                title="Сейчас в системе"
              >
                {avatarUsers.map(u => (
                  <div key={u.id} className="av" title={u.full_name || u.username}>
                    {initials(u)}
                  </div>
                ))}
                {/* Текущий пользователь всегда показывается */}
                <div className="av" title={user?.full_name || user?.username} style={{ background: "var(--iris)", color: "#fff" }}>
                  {initial}
                </div>
                {moreCount > 0 && (
                  <div className="av more">+{moreCount}</div>
                )}
              </div>

              {showUsers && (
                <div style={{ ...popupStyle, minWidth: 240 }}>
                  <div style={{ padding: "12px 16px 8px", fontWeight: 600, fontSize: 13, color: "var(--ink-2)", borderBottom: "1px solid var(--edge)" }}>
                    Сейчас в системе
                  </div>
                  <div style={{ maxHeight: 300, overflowY: "auto", padding: "6px 0" }}>
                    {allUsers.map(u => (
                      <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 16px" }}>
                        <div className="av" style={{
                          width: 30, height: 30, fontSize: 11, flexShrink: 0,
                          background: u.id === user?.id ? "var(--iris)" : "var(--surface)",
                          color: u.id === user?.id ? "#fff" : "var(--ink)",
                        }}>
                          {initials(u)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {u.full_name || u.username}
                            {u.id === user?.id && <span style={{ color: "var(--iris)", fontSize: 11, marginLeft: 5 }}>вы</span>}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                            {ROLE_LABEL[u.role] ?? u.role}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Колокольчик уведомлений ── */}
          <div ref={notifRef} style={{ position: "relative" }}>
            <button
              className="icon-btn"
              title="Уведомления"
              onClick={() => { setShowNotif(v => !v); setShowUsers(false); setShowProfile(false); }}
            >
              <Icon name="bell" size={19} />
              {hasNotif && <span className="dot" />}
            </button>

            {showNotif && (
              <div style={{ ...popupStyle, minWidth: 280 }}>
                <div style={{ padding: "12px 16px 8px", fontWeight: 600, fontSize: 13, color: "var(--ink-2)", borderBottom: "1px solid var(--edge)" }}>
                  Уведомления
                </div>
                <div style={{ padding: "6px 0" }}>
                  {!hasNotif && (
                    <div style={{ padding: "14px 16px", fontSize: 13, color: "var(--ink-3)", textAlign: "center" }}>
                      Нет новых уведомлений
                    </div>
                  )}
                  {openCount > 0 && (
                    <button
                      onClick={() => { navigate("/repairs"); setShowNotif(false); }}
                      style={{
                        width: "100%", textAlign: "left", background: "none", border: "none",
                        padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                        color: "var(--ink)",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--surface)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      <span style={{
                        background: "#e74c3c", color: "#fff", borderRadius: 8,
                        fontSize: 11, fontWeight: 700, padding: "1px 7px", flexShrink: 0,
                      }}>
                        {openCount}
                      </span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>Открытых заявок на ремонт</div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>Требуют внимания</div>
                      </div>
                    </button>
                  )}
                  {compPendingCount > 0 && (
                    <button
                      onClick={() => { navigate("/expenses"); setShowNotif(false); }}
                      style={{
                        width: "100%", textAlign: "left", background: "none", border: "none",
                        padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                        color: "var(--ink)",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--surface)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "none")}
                    >
                      <span style={{
                        background: "#d99a3a", color: "#fff", borderRadius: 8,
                        fontSize: 11, fontWeight: 700, padding: "1px 7px", flexShrink: 0,
                      }}>
                        {compPendingCount}
                      </span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>Заявок на компенсацию</div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>На рассмотрении</div>
                      </div>
                    </button>
                  )}

                  {/* ── Истечение документов ── */}
                  {expiryItems.length > 0 && (
                    <>
                      {(openCount > 0 || compPendingCount > 0) && (
                        <div style={{ height: 1, background: "var(--edge)", margin: "4px 8px" }} />
                      )}
                      <div style={{ padding: "6px 16px 4px", fontSize: 11, fontWeight: 600, color: "var(--ink-3)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                        Документы
                      </div>
                      {expiryItems.slice(0, 7).map((item, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            navigate(item.entity_type === "truck" ? "/directory?tab=vehicles" : "/directory?tab=drivers");
                            setShowNotif(false);
                          }}
                          style={{
                            width: "100%", textAlign: "left", background: "none", border: "none",
                            padding: "7px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                            color: "var(--ink)",
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = "var(--surface)")}
                          onMouseLeave={e => (e.currentTarget.style.background = "none")}
                        >
                          <span style={{
                            background: EXPIRY_COLOR[item.level],
                            color: "#fff", borderRadius: 6,
                            fontSize: 10, fontWeight: 700, padding: "1px 6px",
                            flexShrink: 0, minWidth: 28, textAlign: "center",
                          }}>
                            {item.doc_type}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {item.entity_label}
                            </div>
                            <div style={{ fontSize: 11, color: EXPIRY_COLOR[item.level] }}>
                              {expiryLabel(item.days_left)}
                            </div>
                          </div>
                        </button>
                      ))}
                      {expiryItems.length > 7 && (
                        <div style={{ padding: "4px 16px 8px", fontSize: 11, color: "var(--ink-3)" }}>
                          +{expiryItems.length - 7} ещё...
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ── Меню профиля ── */}
          <div ref={profileRef} style={{ position: "relative" }}>
            <button
              className="me"
              title={user?.full_name || user?.username}
              onClick={() => { setShowProfile(v => !v); setShowUsers(false); setShowNotif(false); }}
              style={{ cursor: "pointer", border: "none", fontFamily: "inherit" }}
            >
              {initial}
            </button>

            {showProfile && (
              <div style={{ ...popupStyle, minWidth: 220 }}>
                {/* Шапка с именем и ролью */}
                <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--edge)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: "var(--iris)", color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, fontWeight: 700, flexShrink: 0,
                    }}>
                      {initial}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {user?.full_name || user?.username}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                        {ROLE_LABEL[user?.role ?? ""] ?? user?.role}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Действия */}
                <div style={{ padding: "6px 0" }}>
                  <button
                    onClick={() => { navigate("/settings"); setShowProfile(false); }}
                    style={{
                      width: "100%", textAlign: "left", background: "none", border: "none",
                      padding: "10px 16px", cursor: "pointer",
                      fontSize: 13, color: "var(--ink)", display: "flex", alignItems: "center", gap: 8,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--surface)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "none")}
                  >
                    <Icon name="cog" size={15} />
                    Настройки профиля
                  </button>
                  <div style={{ height: 1, background: "var(--edge)", margin: "4px 0" }} />
                  <button
                    onClick={handleLogout}
                    style={{
                      width: "100%", textAlign: "left", background: "none", border: "none",
                      padding: "10px 16px", cursor: "pointer",
                      fontSize: 13, color: "#e74c3c", display: "flex", alignItems: "center", gap: 8,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--surface)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "none")}
                  >
                    <Icon name="logout" size={15} />
                    Выйти
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {meta && (
          <div className="pagehead">
            <div className="ph-title">
              <div className="crumbs">
                <Icon name="grid" size={13} /> Автопарк <Icon name="chevr" size={13} /> {meta.crumb}
              </div>
              <h1 className="pagetitle">{meta.title}</h1>
            </div>
            <div className="head-actions">
              <button className="pill-btn round" title="Поиск">
                <Icon name="search" size={18} />
              </button>
              <button className="pill-btn round desk-only" title="Фильтр">
                <Icon name="filter" size={18} />
              </button>
              <button className="pill-btn desk-only">
                <Icon name="calendar" size={17} /> 16–22 июн <Icon name="chevd" size={15} />
              </button>
              <button className="pill-btn solid">
                <Icon name="plus" size={17} /> <span className="lbl-hide">Добавить</span>
              </button>
            </div>
          </div>
        )}

        <Outlet />
      </main>

      <nav className="botnav">
        {visibleNav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            className={({ isActive }) => "bn" + (isActive ? " active" : "")}
            style={{ position: "relative" }}
          >
            <Icon name={n.icon} size={24} /> {n.label}
            {n.to === "/repairs" && openCount > 0 && (
              <span style={{
                position: "absolute", top: 4, right: 4,
                background: "#e74c3c", color: "#fff",
                borderRadius: "50%", fontSize: 9, fontWeight: 700,
                width: 14, height: 14, lineHeight: "14px",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {openCount > 9 ? "9+" : openCount}
              </span>
            )}
            {n.to === "/expenses" && compPendingCount > 0 && (
              <span style={{
                position: "absolute", top: 4, right: 4,
                background: "#d99a3a", color: "#fff",
                borderRadius: "50%", fontSize: 9, fontWeight: 700,
                width: 14, height: 14, lineHeight: "14px",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {compPendingCount > 9 ? "9+" : compPendingCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
