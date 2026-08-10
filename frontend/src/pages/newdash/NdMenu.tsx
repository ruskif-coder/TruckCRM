/**
 * NdMenu — боковое меню логиста (общее для всех экранов /newdash).
 * Закрепляемое/плавающее, тема, блок пользователя. Разделы могут иметь
 * вложенные страницы (children) — раскрываются под пунктом при наведении
 * (и остаются раскрытыми, пока открыта страница раздела). Стили — newdash.css.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { APP_VERSION } from "../../version";
import { useAuth } from "../../auth/AuthContext";
import { useTheme } from "../../theme/ThemeContext";

// Колокольчик рядом с названием раздела — когда внутри есть открытые заявки.
const BellIcon = (
  <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 2.5a4.5 4.5 0 0 1 4.5 4.5c0 3.2 1 4.3 1.5 4.9H3c.5-.6 1.5-1.7 1.5-4.9A4.5 4.5 0 0 1 9 2.5z" />
    <path d="M7.4 14.4a1.7 1.7 0 0 0 3.2 0" />
  </svg>
);

const svgProps = { width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export type NavKey = "desk" | "trips" | "cars" | "drivers" | "refs" | "finance" | "repair" | "reports" | "settings";
type Child = { label: string; to: string };
type Item = { key: NavKey; label: string; to: string; icon: ReactNode; badge?: number; children?: Child[] };

const NAV: Item[] = [
  { key: "desk", label: "Рабочий стол", to: "/newdash", icon: <svg {...svgProps}><rect x="2.5" y="2.5" width="5.5" height="5.5" rx="1.5" /><rect x="10" y="2.5" width="5.5" height="5.5" rx="1.5" /><rect x="2.5" y="10" width="5.5" height="5.5" rx="1.5" /><rect x="10" y="10" width="5.5" height="5.5" rx="1.5" /></svg> },
  {
    key: "trips", label: "Рейсы", to: "/newdash/trips",
    icon: <svg {...svgProps}><circle cx="4" cy="14" r="2" /><circle cx="14" cy="4" r="2" /><path d="M4 12V9a4 4 0 0 1 4-4h4" /></svg>,
    children: [
      { label: "Рейсы", to: "/newdash/trips" },
      { label: "Пробеги", to: "/newdash/trips/mileage" },
      { label: "Акты ПП ТС", to: "/newdash/trips/acts" },
    ],
  },
  { key: "cars", label: "Машины", to: "/newdash/cars", icon: <svg {...svgProps}><path d="M1.5 4.5h8v8h-8z" /><path d="M9.5 7.5h3l3 3v2h-6z" /><circle cx="5" cy="14" r="1.6" /><circle cx="12.8" cy="14" r="1.6" /></svg> },
  { key: "drivers", label: "Водители", to: "/newdash/drivers", icon: <svg {...svgProps}><circle cx="9" cy="6" r="3" /><path d="M3.5 15.5c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" /></svg> },
  {
    key: "refs", label: "Справочники", to: "/newdash/refs",
    icon: <svg {...svgProps}><path d="M4 2.5h7A1.5 1.5 0 0 1 12.5 4v11.5H5.5A1.5 1.5 0 0 1 4 14z" /><path d="M4 12.5h8.5" /><path d="M6.2 5.5h4M6.2 8h4" /></svg>,
    children: [
      { label: "Перевозчики", to: "/newdash/refs" },
      { label: "Контрагенты", to: "/newdash/refs/counterparties" },
    ],
  },
  {
    key: "finance", label: "Финансы", to: "/newdash/finance",
    icon: <svg {...svgProps}><rect x="1.5" y="4" width="15" height="10" rx="2" /><circle cx="9" cy="9" r="2.2" /></svg>,
    children: [
      { label: "Реестр расходов", to: "/newdash/finance" },
      { label: "Топливо", to: "/newdash/finance/fuel" },
      { label: "Заявки", to: "/newdash/finance/claims" },
    ],
  },
  {
    key: "reports", label: "Отчёты", to: "/newdash/reports",
    icon: <svg {...svgProps}><rect x="3" y="2" width="12" height="14" rx="2" /><path d="M6 6h6" /><path d="M6 9h6" /><path d="M6 12h3.5" /></svg>,
    children: [
      { label: "Отчёты", to: "/newdash/reports" },
      { label: "Перевозчики", to: "/newdash/reports/carriers" },
    ],
  },
  { key: "repair", label: "Ремонт", to: "/newdash/repair", icon: <svg {...svgProps}><path d="M11.6 2.6a4.2 4.2 0 0 0-5.2 5.2L2.4 11.8v3.8h3.8l4-4a4.2 4.2 0 0 0 5.2-5.2l-2.4 2.4-2.2-.6-.6-2.2z" /></svg> },
  {
    key: "settings", label: "Настройки", to: "/newdash/settings",
    icon: <svg {...svgProps}><path d="M2.5 5h13" /><path d="M2.5 13h13" /><circle cx="6.5" cy="5" r="1.9" /><circle cx="11.5" cy="13" r="1.9" /></svg>,
    children: [
      { label: "Профиль", to: "/newdash/settings" },
      { label: "Пользователи", to: "/newdash/settings/users" },
      { label: "Роли", to: "/newdash/settings/roles" },
      { label: "Журнал", to: "/newdash/settings/log" },
      { label: "Статьи", to: "/newdash/settings/categories" },
    ],
  },
];

export default function NdMenu({ active }: { active: NavKey }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [hoverKey, setHoverKey] = useState<NavKey | null>(null);
  const menuOpen = pinned || hover;

  // Ролевое сокрытие: админ-подпункты «Настроек» не-админам не показываем
  // (бэкенд всё равно гейтит, но нечего светить структуру и ловить лишние 403).
  const isAdmin = user?.role === "admin";
  const ADMIN_ONLY = new Set(["/newdash/settings/users", "/newdash/settings/roles", "/newdash/settings/log", "/newdash/settings/categories"]);
  const childrenOf = (it: Item) => (it.children || []).filter(c => isAdmin || !ADMIN_ONLY.has(c.to));

  const ROLE_LABELS: Record<string, string> = { admin: "Администратор", foreman: "Бригадир", accountant: "Бухгалтер", driver: "Водитель" };
  const roleLabel = user ? (ROLE_LABELS[user.role] || user.role) : "Логист";
  const nameStr = user?.full_name || user?.username || "Логист";
  const initials = nameStr.trim() ? nameStr.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() : "Л";

  // Кол-во открытых заявок на ремонт → колокольчик у пункта «Ремонт».
  const [repairOpen, setRepairOpen] = useState(0);
  useEffect(() => {
    let alive = true;
    const fetchCount = () => api.get<{ count: number }>("/api/repair-requests/open-count/")
      .then(r => { if (alive) setRepairOpen(r.count || 0); }).catch(() => {});
    fetchCount();
    const t = setInterval(fetchCount, 45000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const badgeOf = (it: Item) => (it.key === "repair" ? repairOpen : it.badge || 0);

  // раздел активен, если открыта его страница или один из вложенных URL
  const sectionActive = (it: Item) =>
    it.key === active || pathname === it.to || (it.children?.some(c => pathname === c.to) ?? false);

  return (
    <div className="menu-slot" data-pinned={pinned}>
      <nav
        className="menu"
        data-open={menuOpen}
        data-floating={!pinned}
        onMouseEnter={() => { if (!pinned) setHover(true); }}
        onMouseLeave={() => { if (!pinned) setHover(false); setHoverKey(null); }}
      >
        <div className="menu__brand">
          <span className="menu__mark"><i /></span>
          <span className="menu__label t-h3">Автопарк</span>
        </div>

        <div className="menu__nav">
          {NAV.map(item => {
            const kids = childrenOf(item);
            const showSub = kids.length > 1 && menuOpen && hoverKey === item.key;
            const badge = badgeOf(item);
            return (
              <div
                key={item.key}
                className="menu__group"
                onMouseEnter={() => item.children && setHoverKey(item.key)}
                onMouseLeave={() => item.children && setHoverKey(k => (k === item.key ? null : k))}
              >
                <button
                  className="menu__item"
                  aria-current={sectionActive(item) ? "page" : undefined}
                  title={item.label}
                  onClick={() => navigate(item.to)}
                >
                  <span className="menu__icon">{item.icon}{badge ? <span className="menu__dot" /> : null}</span>
                  <span className="menu__label">{item.label}</span>
                  {badge ? <span className="menu__bell" title={`Открытых заявок: ${badge}`}>{BellIcon}<span className="menu__bell-count">{badge > 9 ? "9+" : badge}</span></span> : null}
                </button>

                {showSub && (
                  <div className="menu__sub">
                    {kids.map(c => (
                      <button
                        key={c.to}
                        className="menu__subitem"
                        aria-current={pathname === c.to ? "page" : undefined}
                        onClick={() => navigate(c.to)}
                      >
                        <span className="menu__sub-dot" />
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="menu__spacer" style={{ flex: "none", height: 6 }} />

        <button className="menu__item" title="Тема" onClick={toggleTheme}>
          <span className="menu__icon"><svg {...svgProps}><path d="M14.8 10.6A5.8 5.8 0 0 1 7.4 3.2a6.4 6.4 0 1 0 7.4 7.4z" /></svg></span>
          <span className="menu__label">{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</span>
        </button>

        <button
          className="menu__item"
          title={pinned ? "Открепить меню" : "Закрепить меню"}
          style={{ background: pinned ? "var(--surface-2)" : "transparent" }}
          onClick={() => setPinned(p => !p)}
        >
          <span className="menu__icon"><svg {...svgProps}><path d="M7 2.5h4l-.7 4.2 2.7 2.4H5l2.7-2.4z" /><path d="M9 9.1v6.4" /></svg></span>
          <span className="menu__label">{pinned ? "Открепить меню" : "Закрепить меню"}</span>
        </button>

        <button className="menu__item" title="Выйти" onClick={() => { logout(); navigate("/login", { replace: true }); }}>
          <span className="menu__icon"><svg {...svgProps}><path d="M11.5 6V4.5A1.5 1.5 0 0 0 10 3H4.5A1.5 1.5 0 0 0 3 4.5v9A1.5 1.5 0 0 0 4.5 15H10a1.5 1.5 0 0 0 1.5-1.5V12" /><path d="M7.5 9h8" /><path d="M13.5 6.5 16 9l-2.5 2.5" /></svg></span>
          <span className="menu__label">Выйти</span>
        </button>

        <div className="menu__user">
          <span className="avatar">{initials}</span>
          <div className="menu__user-text" style={{ minWidth: 0 }}>
            <div className="t-body-s" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{nameStr}</div>
            <div className="t-caption muted" style={{ whiteSpace: "nowrap" }}>{roleLabel} · v{APP_VERSION}</div>
          </div>
        </div>
      </nav>
    </div>
  );
}
