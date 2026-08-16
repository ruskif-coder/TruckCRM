/**
 * NdNavSheet — лист «Все разделы» снизу (телефон). Открывается по бургеру в
 * шапке страницы (NdPhoneHead). Заменяет нижний таб-бар: полная навигация по
 * разделам с подсказками и подпунктами, тема и выход. Данные разделов — из
 * NAV (NdMenu). Стили — newdash.css (.nd-navsheet*).
 */
import { useLocation, useNavigate } from "react-router-dom";
import { NAV, ADMIN_ONLY_PATHS } from "./NdMenu";
import { useAuth } from "../../auth/AuthContext";
import { useTheme } from "../../theme/ThemeContext";

export default function NdNavSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  if (!open) return null;

  const isAdmin = user?.role === "admin";
  const go = (to: string) => { onClose(); navigate(to); };

  return (
    <div className="nd-navsheet" onClick={onClose}>
      <div className="nd-msheet__backdrop" />
      <div className="nd-msheet__panel nd-navsheet__panel" onClick={e => e.stopPropagation()}>
        <div className="nd-msheet__grip"><i /></div>

        <div className="nd-navsheet__head">
          <span className="menu__mark"><i /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="nd-navsheet__title">Все разделы</div>
            <div className="nd-navsheet__sub">Автопарк · {user?.full_name || user?.username || "Логист"}</div>
          </div>
          <button className="nd-fsheet__close icon-btn icon-btn--plain" title="Закрыть" onClick={onClose}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round"><path d="M3.5 3.5 10.5 10.5" /><path d="M10.5 3.5 3.5 10.5" /></svg>
          </button>
        </div>

        <div className="nd-navsheet__list">
          {NAV.map(it => {
            const kids = (it.children || []).filter(c => isAdmin || !ADMIN_ONLY_PATHS.has(c.to));
            const active = pathname === it.to || (it.children?.some(c => pathname === c.to) ?? false);
            return (
              <div key={it.key} className="nd-navsheet__group">
                <button className="nd-navsheet__row" aria-current={active ? "page" : undefined} onClick={() => go(it.to)}>
                  <span className="nd-navsheet__ico">{it.icon}</span>
                  <span className="nd-navsheet__text">
                    <span className="nd-navsheet__label">{it.label}</span>
                    {it.hint && <span className="nd-navsheet__hint">{it.hint}</span>}
                  </span>
                  <span className="nd-navsheet__chev">›</span>
                </button>
                {active && kids.length > 1 && (
                  <div className="nd-navsheet__kids">
                    {kids.map(c => (
                      <button key={c.to} className={"nd-navsheet__kid" + (pathname === c.to ? " is-active" : "")} onClick={() => go(c.to)}>— {c.label}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="nd-navsheet__foot">
          <button className="btn btn--ghost" style={{ flex: 1 }} onClick={toggleTheme}>{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</button>
          <button className="btn btn--ghost" style={{ flex: 1 }} onClick={() => { onClose(); logout(); navigate("/login", { replace: true }); }}>Выйти</button>
        </div>
      </div>
    </div>
  );
}
