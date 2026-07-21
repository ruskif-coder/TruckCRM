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
  defaultDriverId?: number | null;
  onClose: () => void;
  onSaved: (driverId: number) => void;
};

export default function BonusModal({ drivers, defaultDriverId, onClose, onSaved }: Props) {
  const today = isoDate(new Date());
  const [driverId, setDriverId] = useState<string>(
    defaultDriverId ? String(defaultDriverId) : ""
  );
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!driverId) { setError("Выберите водителя"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { setError("Введите сумму больше нуля"); return; }
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/driver-transactions/", {
        driver_id: Number(driverId),
        tx_type: "bonus",
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

  const selectedDriver = defaultDriverId ? drivers.find((d) => d.id === defaultDriverId) : null;

  return (
    <div className="modal-overlay">
      <div className="fcard" style={{ width: 440, maxWidth: "94vw", padding: 0 }}>
        <div style={{
          background: "var(--dark)", color: "#fff", padding: "16px 24px",
          borderRadius: "26px 26px 0 0", display: "flex",
          justifyContent: "space-between", alignItems: "center",
        }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>Начислить премию</h2>
          <button type="button" onClick={onClose}
            style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>
            ×
          </button>
        </div>

        <div style={{ padding: 24 }}>
          {selectedDriver ? (
            <div style={{ marginBottom: 16 }}>
              <label className="label">Водитель</label>
              <div style={{ fontWeight: 500, marginTop: 4 }}>{driverFullName(selectedDriver)}</div>
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <label className="label">Водитель</label>
              <select className="input" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">— выберите —</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{driverFullName(d)}</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label className="label">Дата</label>
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Сумма, ₽</label>
              <input type="number" className="input" min="0.01" step="0.01" placeholder="0.00"
                value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label className="label">Комментарий</label>
            <input type="text" className="input" value={description}
              onChange={(e) => setDescription(e.target.value)} placeholder="За что начисляется премия" />
          </div>

          <div style={{
            background: "rgba(39,174,96,.08)", border: "1px solid rgba(39,174,96,.25)",
            borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "var(--ink-2)",
          }}>
            Премия увеличивает баланс водителя и не фиксируется в реестре расходов.
          </div>

          {error && <p style={{ color: "var(--ember)", fontSize: 13, margin: "0 0 12px" }}>{error}</p>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="pill-btn" onClick={onClose}>Отмена</button>
            <button type="button" className="pill-btn solid" disabled={saving} onClick={handleSave}>
              {saving ? "Сохранение..." : "Начислить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
