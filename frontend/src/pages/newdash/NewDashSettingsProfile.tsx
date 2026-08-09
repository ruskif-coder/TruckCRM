/**
 * NewDashSettingsProfile — вкладка «Профиль» (/newdash/settings).
 * Учётная запись (ФИО/логин/роль) + выбор темы. Доступна всем ролям.
 */
import { useAuth } from "../../auth/AuthContext";
import { useTheme } from "../../theme/ThemeContext";
import NewDashSettingsShell from "./NewDashSettingsShell";

const ROLE_LABELS: Record<string, string> = { admin: "Администратор", foreman: "Бригадир", accountant: "Бухгалтер", driver: "Водитель" };

export default function NewDashSettingsProfile() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  return (
    <NewDashSettingsShell title="Настройки" subtitle="профиль и оформление">
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "16px 32px 24px" }}>
        <section className="section" style={{ maxWidth: 560 }}>
          <div className="t-mono-label section__title">Учётная запись</div>
          <div className="form-grid">
            <div className="field"><span className="field__label">ФИО</span><div className="t-body" style={{ fontWeight: 600 }}>{user?.full_name || "—"}</div></div>
            <div className="field"><span className="field__label">Логин</span><div className="t-body" style={{ fontWeight: 600 }}>{user?.username || "—"}</div></div>
            <div className="field"><span className="field__label">Роль</span><div className="t-body" style={{ fontWeight: 600 }}>{user ? (ROLE_LABELS[user.role] || user.role) : "—"}</div></div>
          </div>
        </section>

        <section className="section" style={{ maxWidth: 560, marginTop: 16 }}>
          <div className="t-mono-label section__title">Тема оформления</div>
          <span className="segments">
            <button className="segments__item" aria-selected={theme === "light"} onClick={() => setTheme("light")}>Светлая</button>
            <button className="segments__item" aria-selected={theme === "dark"} onClick={() => setTheme("dark")}>Тёмная</button>
          </span>
        </section>
      </div>
    </NewDashSettingsShell>
  );
}
