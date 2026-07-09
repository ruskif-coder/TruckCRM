import type { CSSProperties } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const navLinkStyle = (isActive: boolean): CSSProperties => ({
  display: "block",
  padding: "10px 16px",
  borderRadius: 9999,
  color: isActive ? "#ffffff" : "var(--smoke)",
  background: isActive ? "var(--iris)" : "transparent",
  fontSize: 14,
  fontWeight: 500,
  marginBottom: 4,
});

export default function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: 220,
          borderRight: "1px solid var(--edge)",
          padding: 20,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 24px" }}>
          <img src="/logo.svg" alt="logo" style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Транспорт CRM</span>
        </div>
        <nav style={{ flex: 1 }}>
          <NavLink to="/" style={({ isActive }) => navLinkStyle(isActive)} end>
            Дашборд
          </NavLink>
          <NavLink to="/trips" style={({ isActive }) => navLinkStyle(isActive)}>
            Реестр поездок
          </NavLink>
          <NavLink to="/fuel" style={({ isActive }) => navLinkStyle(isActive)}>
            Топливо
          </NavLink>
          <NavLink to="/drivers" style={({ isActive }) => navLinkStyle(isActive)}>
            Водители
          </NavLink>
          <NavLink to="/expenses" style={({ isActive }) => navLinkStyle(isActive)}>
            Расходы
          </NavLink>
        </nav>
        <div style={{ borderTop: "1px solid var(--edge)", paddingTop: 16 }}>
          <p style={{ fontSize: 13, color: "var(--smoke)", margin: "0 0 10px" }}>{user?.full_name || user?.username}</p>
          <button className="btn btn-ghost" style={{ width: "100%" }} onClick={handleLogout}>
            Выйти
          </button>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 32 }}>
        <Outlet />
      </main>
    </div>
  );
}
