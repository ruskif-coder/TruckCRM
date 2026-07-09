import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { clearToken, getToken, login as loginRequest, setToken } from "../api";

// driver_id добавлен 2026-06-29 ("журнал пробегов", вкладка "Пробеги" в
// "Рейсы") - нужен, чтобы форма добавления записи могла понять, что вошёл
// именно водитель, и автозаполнить/заблокировать поле "Водитель" им самим
// (см. pages/Mileage.tsx). null для остальных ролей.
// consent_given добавлен 2026-07-04: флаг принятия политики ПД (152-ФЗ),
// читается из /api/auth/login и /api/auth/me. false → показать ConsentModal.
type User = { id: number; username: string; role: string; full_name: string; driver_id: number | null; consent_given: boolean };

type AuthState = {
  user: User | null;
  ready: boolean;
  // Возвращает User, чтобы Login.tsx мог направить водителя на /driver
  // вместо главной страницы (роль "driver" → DriverDashboard.tsx).
  login: (username: string, password: string) => Promise<User>;
  logout: () => void;
  // setUser — используется ConsentGate в App.tsx для обновления consent_given
  // после подтверждения без повторного запроса к серверу.
  setUser: (u: User) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setReady(true);
      return;
    }
    fetch(`${import.meta.env.VITE_API_URL || "http://localhost:8000"}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("invalid session");
        return r.json();
      })
      .then((data) => setUser(data))
      .catch(() => clearToken())
      .finally(() => setReady(true));
  }, []);

  async function login(username: string, password: string) {
    const data = await loginRequest(username, password);
    setToken(data.access_token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    // Fire-and-forget: пишем запись в журнал; не ждём ответа и не блокируем
    // выход при ошибке сети — токен всё равно удаляется на клиенте.
    const token = getToken();
    if (token) {
      fetch(`${import.meta.env.VITE_API_URL || "http://localhost:8000"}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {/* игнорируем — logout не блокируем */});
    }
    clearToken();
    setUser(null);
  }

  // Wrapper с узким типом (u: User) для ConsentGate в App.tsx — позволяет
  // обновить consent_given в памяти без повторного запроса к серверу.
  function updateUser(u: User) {
    setUser(u);
  }

  return <AuthContext.Provider value={{ user, ready, login, logout, setUser: updateUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
