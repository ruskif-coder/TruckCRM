import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import AppShell from "./components/AppShell";
import ConsentModal from "./components/ConsentModal";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import Dashboard from "./pages/Dashboard";
import Directories from "./pages/Directories";
import DriverDashboard from "./pages/DriverDashboard";
import DriverTrips from "./pages/DriverTrips";
import ForemanDashboard from "./pages/ForemanDashboard";
import Expenses from "./pages/Expenses";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import Repairs from "./pages/Repairs";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Trips from "./pages/Trips";

// Отображает ConsentModal поверх всего контента, если пользователь вошёл,
// но ещё не дал согласие с ПД. Обновляет AuthContext через setUser после
// подтверждения — для этого нужен доступ к useAuth внутри AuthProvider.
function ConsentGate({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  const needConsent = user !== null && !user.consent_given;

  function handleAccepted() {
    if (user) setUser({ ...user, consent_given: true });
  }

  return (
    <>
      {children}
      {needConsent && <ConsentModal onAccepted={handleAccepted} />}
    </>
  );
}

/**
 * Умный fallback для неизвестных URL-ов.
 * Вместо слепого Navigate to="/" сразу отправляет пользователя
 * по его роли — водитель и бригадир никогда не попадают в AppShell.
 * 2026-07-07.
 */
function RoleRedirect() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "driver")  return <Navigate to="/driver"  replace />;
  if (user.role === "foreman") return <Navigate to="/foreman" replace />;
  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ConsentGate>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          {/* Мобильный дашборд водителя — standalone, без AppShell (2026-06-30) */}
          <Route
            path="/driver"
            element={
              <ProtectedRoute>
                <DriverDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/driver/trips"
            element={
              <ProtectedRoute>
                <DriverTrips />
              </ProtectedRoute>
            }
          />
          {/* Мобильный дашборд бригадира — standalone, без AppShell (2026-07-04) */}
          <Route
            path="/foreman"
            element={
              <ProtectedRoute requiredRole="foreman">
                <ForemanDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="directory" element={<Directories />} />
            <Route path="trips" element={<Trips />} />
            <Route path="expenses" element={<Expenses />} />
            <Route path="repairs" element={<Repairs />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          {/* Любой неизвестный URL — редирект по роли, не слепой Navigate to="/" */}
          <Route path="*" element={<RoleRedirect />} />
        </Routes>
        </ConsentGate>
      </AuthProvider>
    </ThemeProvider>
  );
}
