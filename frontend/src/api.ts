// Пустая строка = относительный URL: браузер шлёт /api/... на текущий origin,
// nginx проксирует на backend по имени сервиса внутри Docker-сети.
// Это позволяет одному dist/ работать и в PROD (:80), и в STAGING (:81).
// Для локальной разработки вне Docker задайте VITE_API_URL=http://localhost:8000
export const API_URL = import.meta.env.VITE_API_URL || "";

const TOKEN_KEY = "transport_crm_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// FastAPI's automatic request-validation errors (HTTP 422) put a *list* of
// error objects in `detail` (e.g. [{loc: ["body","date"], msg: "...", type:
// "..."}]), not a string. The old code did `data.detail || JSON.stringify(data)`,
// which picked the raw array (truthy) without stringifying it - passing a
// non-string into `new ApiError(status, detail)` made JS's Error ctor coerce
// it via ToString, silently producing "[object Object]" for a single-item
// array (reported 2026-06-23 editing an Expenses entry). Flatten every
// possible shape (string / validation-error array / plain object) into a
// readable string here instead.
function errorDetailToString(data: unknown): string {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        if (d && typeof d === "object" && "msg" in d) {
          const loc = Array.isArray((d as any).loc) ? (d as any).loc.slice(1).join(".") : "";
          return loc ? `${loc}: ${(d as any).msg}` : String((d as any).msg);
        }
        return JSON.stringify(d);
      })
      .join("; ");
  }
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return JSON.stringify(data);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new ApiError(401, "Сессия истекла, нужно войти заново");
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = errorDetailToString(data) || res.statusText;
    } catch {
      // body wasn't JSON — keep statusText
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined }),
  // Added 2026-06-20 for the expenses bulk mass-edit endpoint
  // (PATCH /api/expenses/bulk) - same shape as put(), different verb.
  patch: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T,>(path: string, file: File, fields?: Record<string, string>) => {
    const form = new FormData();
    form.append("file", file);
    if (fields) {
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
    }
    return request<T>(path, { method: "POST", body: form });
  },
  // File download (e.g. import templates). Plain <a href> won't carry the
  // JWT, so this fetches with the auth header like everything else and
  // saves the response via a throwaway blob link.
  download: async (path: string, filename: string) => {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_URL}${path}`, { headers });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  // Кнопка "Экспорт" в реестре поездок (2026-06-29) - как download() выше,
  // но с телом запроса (POST): нужно передать на бэкенд уже отфильтрованный
  // и отсортированный список строк, а не просто скачать статичный файл по
  // GET. Ответ всё равно бинарный (.xlsx), не JSON - поэтому отдельный
  // метод, а не api.post() (тот всегда делает res.json()).
  downloadPost: async (path: string, body: unknown, filename: string) => {
    const token = getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

/**
 * Логирует скачивание файла в журнал действий (fire-and-forget).
 * Вызывается из onClick на <a download> элементах — ошибки игнорируются,
 * чтобы не блокировать скачивание при проблемах с сетью/сессией.
 */
export function logDownload(filename: string, zone = "documents"): void {
  const token = getToken();
  if (!token) return;
  fetch(`${API_URL}/api/audit-log/download`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ filename, zone }),
  }).catch(() => {/* игнорируем */});
}

export async function login(username: string, password: string) {
  const form = new URLSearchParams();
  form.append("username", username);
  form.append("password", password);

  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });

  if (!res.ok) {
    let detail = "Неверный логин или пароль";
    try {
      const data = await res.json();
      detail = errorDetailToString(data) || detail;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, detail);
  }

  return res.json() as Promise<{
    access_token: string;
    token_type: string;
    user: { id: number; username: string; role: string; full_name: string; driver_id: number | null; consent_given: boolean };
  }>;
}
