/**
 * NdTxModal — форма начисления/списания по балансу водителя (шаблон NdModal).
 * Одна форма на 4 типа: выплата / аванс / премия / штраф (со сдвоенным типом).
 * Сумма + быстрые чипы + комментарий. POST /api/driver-transactions/
 * (фронт шлёт положительную сумму + tx_type + date, знак ставит бэкенд).
 */
import { useState } from "react";
import { api, ApiError } from "../../api";
import { isoDate, money } from "../../lib/format";
import NdModal from "./NdModal";

export type TxKind = "payout" | "advance" | "bonus" | "fine";

const CFG: Record<TxKind, { title: string; tx: string; hint: string; commentPh: string }> = {
  payout:  { title: "Провести выплату",   tx: "payout",  hint: "Закроет задолженность перед водителем", commentPh: "Наличными, на карту, за какую неделю" },
  advance: { title: "Выдать аванс",       tx: "advance", hint: "Спишется с баланса водителя",           commentPh: "Наличными, кто выдал" },
  bonus:   { title: "Начислить премию",   tx: "bonus",   hint: "Добавится к балансу водителя",          commentPh: "За что начисляется премия" },
  fine:    { title: "Выписать штраф",      tx: "fine_pdd", hint: "Спишется с баланса водителя",          commentPh: "За что и по какому рейсу" },
};

export default function NdTxModal({ kind, driverId, driverName, balance, onClose, onSaved }: {
  kind: TxKind;
  driverId: number;
  driverName: string;
  balance: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const cfg = CFG[kind];
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [fineType, setFineType] = useState<"fine_pdd" | "fine_company">("fine_pdd");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quick = kind === "payout" || kind === "advance"
    ? [20000, 50000, Math.round(Math.abs(balance))].filter((v, i, a) => v > 0 && a.indexOf(v) === i)
    : [1000, 5000, 10000];

  const txType = kind === "fine" ? fineType : cfg.tx;
  const needComment = kind === "fine" && fineType === "fine_company";
  const amt = Number(amount);
  const canSubmit = amt > 0 && !(needComment && !comment.trim()) && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true); setError(null);
    try {
      await api.post("/api/driver-transactions/", { driver_id: driverId, tx_type: txType, date: isoDate(new Date()), amount: amt, description: comment.trim() });
      onSaved();
    } catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  }

  return (
    <NdModal
      size="form"
      title={cfg.title}
      subtitle={driverName}
      onClose={onClose}
      actions={[
        { label: "Отмена", kind: "ghost", onClick: onClose },
        { label: saving ? "…" : "Провести", kind: "accent", grow: true, disabled: !canSubmit, onClick: submit },
      ]}
    >
      {kind === "fine" && (
        <div className="segments segments--flush" style={{ alignSelf: "flex-start" }}>
          <button className="segments__item" aria-selected={fineType === "fine_pdd"} onClick={() => setFineType("fine_pdd")}>Штраф ПДД</button>
          <button className="segments__item" aria-selected={fineType === "fine_company"} onClick={() => setFineType("fine_company")}>От компании</button>
        </div>
      )}

      <div className="field">
        <span className="field__label">Сумма, ₽</span>
        <input type="number" inputMode="numeric" className="field__input field__input--amount" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" autoFocus />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {quick.map(v => (
          <button key={v} type="button" className="btn btn--ghost" style={{ fontFamily: "var(--font-mono)" }} onClick={() => setAmount(String(v))}>{money(v).replace(" ₽", "")}</button>
        ))}
      </div>

      <div className="field">
        <span className="field__label">Комментарий{needComment ? " *" : ""}</span>
        <textarea rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder={cfg.commentPh} />
      </div>

      <span className="t-caption muted">{cfg.hint}</span>
      {error && <div className="field__error">{error}</div>}
    </NdModal>
  );
}
