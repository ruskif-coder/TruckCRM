import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API_URL, ApiError } from "../api";

// Страница сброса пароля — открывается по ссылке /reset-password?token=xxx.
// Токен создаётся на бэкенде при запросе сброса (POST /api/auth/request-reset)
// и логируется (SMTP задача отдельно, пока ссылка пишется в лог).
export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";

  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) {
      setError("Пароль должен содержать не менее 6 символов");
      return;
    }
    if (newPassword !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    if (!token) {
      setError("Ссылка для сброса пароля недействительна");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: newPassword }),
      });
      if (!res.ok) {
        let detail = "Ошибка сброса пароля";
        try {
          const data = await res.json();
          if (typeof data.detail === "string") detail = data.detail;
        } catch { /* ignore */ }
        throw new ApiError(res.status, detail);
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка сброса пароля");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="card" style={{ width: 360 }}>
        <h1 style={{ fontSize: 24, marginTop: 0, marginBottom: 4 }}>Транспорт CRM</h1>
        <p style={{ color: "var(--smoke)", marginTop: 0, marginBottom: 24, fontSize: 14 }}>Новый пароль</p>

        {!token && (
          <p style={{ color: "var(--ember)", fontSize: 14, marginBottom: 20 }}>
            Ссылка для сброса пароля недействительна или устарела.
          </p>
        )}

        {done ? (
          <>
            <p style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
              Пароль успешно изменён. Теперь вы можете войти с новым паролем.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "100%" }}
              onClick={() => navigate("/login", { replace: true })}
            >
              Войти
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="label" htmlFor="new-password">
              Новый пароль
            </label>
            <input
              id="new-password"
              type="password"
              className="input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoFocus
              autoComplete="new-password"
              style={{ marginBottom: 16 }}
            />

            <label className="label" htmlFor="confirm-password">
              Повторите пароль
            </label>
            <input
              id="confirm-password"
              type="password"
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              style={{ marginBottom: 20 }}
            />

            {error && (
              <p style={{ color: "var(--ember)", fontSize: 13, marginTop: -8, marginBottom: 16 }}>{error}</p>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !token}
              style={{ width: "100%", marginBottom: 12 }}
            >
              {loading ? "Сохранение..." : "Сохранить пароль"}
            </button>

            <button
              type="button"
              style={{ width: "100%", background: "none", border: "none", color: "var(--ink-3)", fontSize: 13, cursor: "pointer", padding: "4px 0" }}
              onClick={() => navigate("/login", { replace: true })}
            >
              ← Вернуться к входу
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
