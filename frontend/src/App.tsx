import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
// [старый интерфейс отключён 2026-08-09 — см. блок маршрутов ниже] import AppShell from "./components/AppShell";
import ConsentModal from "./components/ConsentModal";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
// [старый интерфейс отключён 2026-08-09] import Dashboard from "./pages/Dashboard";
// [старый интерфейс отключён 2026-08-09] import Directories from "./pages/Directories";
import DriverDashboard from "./pages/DriverDashboard";
import DriverTrips from "./pages/DriverTrips";
import ForemanDashboard from "./pages/ForemanDashboard";
import NewDash from "./pages/newdash/NewDash";
import NewDashTrips from "./pages/newdash/NewDashTrips";
import NewDashMileage from "./pages/newdash/NewDashMileage";
import NewDashActs from "./pages/newdash/NewDashActs";
import NewDashVehicles from "./pages/newdash/NewDashVehicles";
import NewDashDrivers from "./pages/newdash/NewDashDrivers";
import NewDashExpenses from "./pages/newdash/NewDashExpenses";
import NewDashFuel from "./pages/newdash/NewDashFuel";
import NewDashClaims from "./pages/newdash/NewDashClaims";
import NewDashReports from "./pages/newdash/NewDashReports";
import NewDashReportsSummary from "./pages/newdash/NewDashReportsSummary";
import NewDashCarriers from "./pages/newdash/NewDashCarriers";
import NewDashRefCarriers from "./pages/newdash/NewDashRefCarriers";
import NewDashCounterparties from "./pages/newdash/NewDashCounterparties";
import NewDashRepair from "./pages/newdash/NewDashRepair";
import NewDashSettingsProfile from "./pages/newdash/NewDashSettingsProfile";
import NewDashSettingsUsers from "./pages/newdash/NewDashSettingsUsers";
import NewDashSettingsRoles from "./pages/newdash/NewDashSettingsRoles";
import NewDashSettingsLog from "./pages/newdash/NewDashSettingsLog";
import NewDashSettingsCategories from "./pages/newdash/NewDashSettingsCategories";
// [старый интерфейс отключён 2026-08-09] import Expenses from "./pages/Expenses";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
// [старый интерфейс отключён 2026-08-09] import Repairs from "./pages/Repairs";
// [старый интерфейс отключён 2026-08-09] import Reports from "./pages/Reports";
// [старый интерфейс отключён 2026-08-09] import Settings from "./pages/Settings";
// [старый интерфейс отключён 2026-08-09] import Trips from "./pages/Trips";

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
  return <Navigate to="/newdash" replace />;
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
          {/* Новый рабочий стол логиста — standalone, без AppShell (/newdash) */}
          <Route
            path="/newdash"
            element={
              <ProtectedRoute>
                <NewDash />
              </ProtectedRoute>
            }
          />
          <Route
            path="/newdash/trips"
            element={
              <ProtectedRoute>
                <NewDashTrips />
              </ProtectedRoute>
            }
          />
          <Route
            path="/newdash/trips/mileage"
            element={
              <ProtectedRoute>
                <NewDashMileage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/newdash/trips/acts"
            element={
              <ProtectedRoute>
                <NewDashActs />
              </ProtectedRoute>
            }
          />
          <Route
            path="/newdash/cars"
            element={
              <ProtectedRoute>
                <NewDashVehicles />
              </ProtectedRoute>
            }
          />
          <Route
            path="/newdash/drivers"
            element={
              <ProtectedRoute>
                <NewDashDrivers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/newdash/finance"
            element={
              <ProtectedRoute>
                <NewDashExpenses />
              </ProtectedRoute>
            }
          />
          <Route
            path="/newdash/finance/fuel"
            element={
              <ProtectedRoute>
                <NewDashFuel />
              </ProtectedRoute>
            }
          />
          <Route
            path="/newdash/finance/claims"
            element={
              <ProtectedRoute>
                <NewDashClaims />
              </ProtectedRoute>
            }
          />
          <Route
            path="/newdash/reports"
            element={
              <ProtectedRoute>
                <NewDashReports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/newdash/reports/summary"
            element={
              <ProtectedRoute>
                <NewDashReportsSummary />
              </ProtectedRoute>
            }
          />
          <Route
            path="/newdash/reports/carriers"
            element={
              <ProtectedRoute>
                <NewDashCarriers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/newdash/refs"
            element={
              <ProtectedRoute>
                <NewDashRefCarriers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/newdash/refs/counterparties"
            element={
              <ProtectedRoute>
                <NewDashCounterparties />
              </ProtectedRoute>
            }
          />
          <Route
            path="/newdash/repair"
            element={
              <ProtectedRoute>
                <NewDashRepair />
              </ProtectedRoute>
            }
          />
          <Route path="/newdash/settings" element={<ProtectedRoute><NewDashSettingsProfile /></ProtectedRoute>} />
          <Route path="/newdash/settings/users" element={<ProtectedRoute><NewDashSettingsUsers /></ProtectedRoute>} />
          <Route path="/newdash/settings/roles" element={<ProtectedRoute><NewDashSettingsRoles /></ProtectedRoute>} />
          <Route path="/newdash/settings/log" element={<ProtectedRoute><NewDashSettingsLog /></ProtectedRoute>} />
          <Route path="/newdash/settings/categories" element={<ProtectedRoute><NewDashSettingsCategories /></ProtectedRoute>} />
          {/* Мобильный дашборд бригадира — standalone, без AppShell (2026-07-04) */}
          <Route
            path="/foreman"
            element={
              <ProtectedRoute requiredRole="foreman">
                <ForemanDashboard />
              </ProtectedRoute>
            }
          />
          {/* Старый интерфейс (AppShell) ОТКЛЮЧЁН 2026-08-09: админа/логиста
             постоянно «выкидывало» на него при заходе на корень «/». Теперь
             корень редиректит по роли на /newdash (и /driver, /foreman), а все
             старые пути ловит catch-all «*» ниже. Чтобы вернуть старый UI —
             раскомментировать блок ниже и импорты AppShell/Dashboard/…/Trips. */}
          <Route path="/" element={<RoleRedirect />} />
          {/*
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
          */}
          {/* Любой неизвестный URL (в т.ч. старые пути) — редирект по роли */}
          <Route path="*" element={<RoleRedirect />} />
        </Routes>
        </ConsentGate>
      </AuthProvider>
    </ThemeProvider>
  );
}
