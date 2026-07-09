import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

interface Props {
  children: ReactNode;
  /** Если задано — доступ только для этой роли (или admin).
   *  Остальные редиректятся на /driver. */
  requiredRole?: string;
}

export default function ProtectedRoute({ children, requiredRole }: Props) {
  const { user, ready } = useAuth();
  const { pathname } = useLocation();

  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;

  // Если маршрут требует конкретной роли — проверяем.
  // admin проходит всегда.
  if (requiredRole && user.role !== "admin" && user.role !== requiredRole) {
    return <Navigate to="/driver" replace />;
  }

  // Водитель и бригадир не должны попадать в десктопный интерфейс.
  if (!requiredRole) {
    if (user.role === "driver" && !pathname.startsWith("/driver")) {
      return <Navigate to="/driver" replace />;
    }
    if (user.role === "foreman" && !pathname.startsWith("/foreman") && !pathname.startsWith("/driver")) {
      return <Navigate to="/foreman" replace />;
    }
  }

  return <>{children}</>;
}
