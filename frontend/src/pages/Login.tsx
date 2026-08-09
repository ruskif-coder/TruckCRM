import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { API_URL, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";

type View = "login" | "forgot" | "forgot_sent";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("login");

  // Login form state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Forgot password form state
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotLoading, setForgotLoading] = useState(false);

  // Нормализация телефона: убирает всё кроме цифр, приводит 8-xxx и +7-xxx к 7xxx.
  // Срабатывает только если похоже на телефон (10 или 11 цифр); иначе возвращает
  // строку как есть (для обычных текстовых логинов).
  function normalizeUsername(raw: string): string {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) {
      return "7" + digits.slice(1);
    }
    if (digits.length === 10) {
      return "7" + digits;
    }
    return raw.trim();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const u = await login(normalizeUsername(username), password);
      // Водители и бригадиры — мобильный кабинет, остальные — новый рабочий стол (/newdash).
      // Старый интерфейс остаётся доступен по "/" как временный fallback.
      const dest = u.role === "driver" ? "/driver" : u.role === "foreman" ? "/foreman" : "/newdash";
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: FormEvent) {
    e.preventDefault();
    setForgotError(null);
    if (!forgotEmail.trim()) {
      setForgotError("Введите адрес электронной почты");
      return;
    }
    setForgotLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/request-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim().toLowerCase() }),
      });
      if (!res.ok) throw new Error("Ошибка запроса");
      setView("forgot_sent");
    } catch {
      setForgotError("Не удалось отправить запрос. Попробуйте позже.");
    } finally {
      setForgotLoading(false);
    }
  }

  if (view === "forgot" || view === "forgot_sent") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="card" style={{ width: 360 }}>
          <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Транспорт CRM</h1>
          <p style={{ color: "var(--smoke)", marginTop: 0, marginBottom: 24, fontSize: 14 }}>Сброс пароля</p>

          {view === "forgot_sent" ? (
            <>
              <p style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
                Если указанный адрес зарегистрирован в системе, на него придёт ссылка для сброса пароля.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: "100%" }}
                onClick={() => setView("login")}
              >
                Вернуться к входу
              </button>
            </>
          ) : (
            <form onSubmit={handleForgot}>
              <label className="label" htmlFor="forgot-email">
                Эл. почта
              </label>
              <input
                id="forgot-email"
                type="email"
                className="input"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                autoFocus
                placeholder="user@example.com"
                style={{ marginBottom: 16 }}
              />
              {forgotError && (
                <p style={{ color: "var(--ember)", fontSize: 13, marginTop: -8, marginBottom: 16 }}>{forgotError}</p>
              )}
              <button type="submit" className="btn btn-primary" disabled={forgotLoading} style={{ width: "100%", marginBottom: 12 }}>
                {forgotLoading ? "Отправка..." : "Отправить ссылку"}
              </button>
              <button
                type="button"
                style={{ width: "100%", background: "none", border: "none", color: "var(--ink-3)", fontSize: 13, cursor: "pointer", padding: "4px 0" }}
                onClick={() => setView("login")}
              >
                ← Вернуться к входу
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <form onSubmit={handleSubmit} className="card" style={{ width: 360 }}>
        <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Транспорт CRM</h1>
        <p style={{ color: "var(--smoke)", marginTop: 0, marginBottom: 24, fontSize: 14 }}>Вход в систему</p>

        <label className="label" htmlFor="username">
          Логин
        </label>
        <input
          id="username"
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
          style={{ marginBottom: 16 }}
        />

        <label className="label" htmlFor="password">
          Пароль
        </label>
        <input
          id="password"
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          style={{ marginBottom: 20 }}
        />

        {error && <p style={{ color: "var(--ember)", fontSize: 13, marginTop: -8, marginBottom: 16 }}>{error}</p>}

        <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: "100%", marginBottom: 12 }}>
          {loading ? "Вход..." : "Войти"}
        </button>

        <button
          type="button"
          style={{ width: "100%", background: "none", border: "none", color: "var(--ink-3)", fontSize: 13, cursor: "pointer", padding: "4px 0" }}
          onClick={() => { setView("forgot"); setForgotEmail(""); setForgotError(null); }}
        >
          Забыли пароль?
        </button>
      </form>
    </div>
  );
}
