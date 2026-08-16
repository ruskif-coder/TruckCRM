/**
 * NewDashSettingsShell — общая оболочка раздела «Настройки»: меню + топбар +
 * слайдер-табы (Профиль/Пользователи/Роли/Журнал/Статьи). Профиль виден всем,
 * остальные — только admin. Каждая вкладка = отдельная страница/URL.
 */
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import NdMenu from "./NdMenu";
import NdSectionTabs, { SETTINGS_TABS } from "./NdSectionTabs";
import NdPhoneHead from "./NdPhoneHead";
import { useIsPhone } from "./shared";
import "./newdash.css";

export default function NewDashSettingsShell({
  title, subtitle, right, adminOnly, children,
}: { title: string; subtitle?: string; right?: ReactNode; adminOnly?: boolean; children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const isPhone = useIsPhone();
  const tabs = isAdmin ? SETTINGS_TABS : SETTINGS_TABS.slice(0, 1);

  return (
    <div className="nd">
      <NdMenu active="settings" />
      <main className="main" data-pad="wide">
        {isPhone ? (
          <NdPhoneHead title={title} subtitle={subtitle} />
        ) : (
          <header className="topbar">
            <div className="topbar__title">
              <h1 className="t-h1" style={{ margin: 0 }}>{title}</h1>
              {subtitle && <span className="t-mono muted">{subtitle}</span>}
            </div>
          </header>
        )}

        <NdSectionTabs tabs={tabs} right={isAdmin ? right : undefined} />

        {adminOnly && !isAdmin ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <div className="t-h3" style={{ color: "var(--text-2)" }}>Доступ только для администратора</div>
            <button className="btn btn--ghost" onClick={() => navigate("/newdash/settings")}>К профилю</button>
          </div>
        ) : children}
      </main>
    </div>
  );
}
