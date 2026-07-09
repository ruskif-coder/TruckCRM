/**
 * Модальное окно «Выписать штраф» (2026-07-05).
 * Создаёт DriverTransaction типа fine_pdd или fine_company для выбранного водителя.
 * Используется в Drivers.tsx и Expenses.tsx.
 */
import { useState } from "react";
import { api, ApiError } from "../api";
import { isoDate } from "../lib/format";

type Driver = {
  id: number;
  name: string;
  last_name: string;
  first_name: string;
  middle_name: string;
};

function driverFullName(d: Driver): string {
  const parts = [d.last_name, d.first_name, d.middle_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : d.name || "—";
}

type Props = {
  drivers: Driver[];
  /** Если передан — водитель уже выбран, поле выбора скрыто */
  defaultDriverId?: number | null;
  onClose: () => void;
  /** Вызывается после успешного сохранения. Передаёт driver_id */
  onSaved: (driverId: number) => void;
};

export default function FineModal({ drivers, defaultDriverId, onClose, onSaved }: Props) {
  const today = isoDate(new Date());
  const [driverId, setDriverId] = useState<string>(
    defaultDriverId ? String(defaultDriverId) : ""
  );
  const [txType, setTxType] = useState<"fine_pdd" | "fine_company">("fine_pdd");
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!driverId) {
      setError("Выберите водителя");
      return;
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Введите сумму больше нуля");
      return;
    }
    if (txType === "fine_company" && !description.trim()) {
      setError("Для штрафа от компании обязателен комментарий");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/driver-transactions/", {
        driver_id: Number(driverId),
        tx_type: txType,
        date,
        amount: amt,
        description: description.trim(),
      });
      onSaved(Number(driverId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  const selectedDriver = defaultDriverId
    ? drivers.find((d) => d.id === defaultDriverId)
    : null;

  return (
    <div className="modal-overlay">
      <div className="fcard" style={{ width: 480, maxWidth: "94vw", padding: 0 }}>
        {/* Шапка */}
        <div
          style={{
            background: "var(--dark)",
            color: "#fff",
            padding: "16px 24px",
            borderRadius: "26px 26px 0 0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ fontSize: 18, margin: 0 }}>Выписать штраф</h2>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Тело */}
        <div style={{ padding: 24 }}>
          {/* Водитель */}
          {selectedDriver ? (
            <div style={{ marginBottom: 16 }}>
              <label className="label">Водитель</label>
              <div style={{ fontWeight: 500, marginTop: 4 }}>{driverFullName(selectedDriver)}</div>
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <label className="label">Водитель</label>
              <select
                className="input"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
              >
                <option value="">— выберите —</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {driverFullName(d)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Вид штрафа */}
          <div style={{ marginBottom: 16 }}>
            <label className="label">Вид штрафа</label>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button
                type="button"
                className={`pill-btn${txType === "fine_pdd" ? " solid" : ""}`}
                onClick={() => setTxType("fine_pdd")}
              >
                Штраф ПДД
              </button>
              <button
                type="button"
                className={`pill-btn${txType === "fine_company" ? " solid" : ""}`}
                onClick={() => setTxType("fine_company")}
              >
                От компании
              </button>
            </div>
          </div>

          {/* Дата + сумма */}
          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label className="label">Дата</label>
              <input
                type="date"
                className="input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Сумма, ₽</label>
              <input
                type="number"
                className="input"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          {/* Комментарий */}
          <div style={{ marginBottom: 16 }}>
            <label className="label">
              Комментарий{txType === "fine_company" ? " *" : ""}
            </label>
            <input
              type="text"
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                txType === "fine_company"
                  ? "Причина штрафа (обязательно)"
                  : "Номер постановления и т.п."
              }
            />
          </div>

          {/* Пояснение: штраф ПДД → автоматически создаёт расход в кассе */}
          {txType === "fine_pdd" && (
            <div
              style={{
                background: "rgba(239,68,68,.06)",
                border: "1px solid rgba(239,68,68,.2)",
                borderRadius: 10,
                padding: "10px 14px",
                marginBottom: 16,
                fontSize: 13,
                color: "var(--ink-2)",
              }}
            >
              Автоматически создаст расход в реестре расходов (категория «Штрафы»).
            </div>
          )}

          {error && (
            <p style={{ color: "var(--ember)", fontSize: 13, margin: "0 0 12px" }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="pill-btn" onClick={onClose}>
              Отмена
            </button>
            <button
              type="button"
              className="pill-btn solid"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? "Сохранение..." : "Выписать штраф"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
