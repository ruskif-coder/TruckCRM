/**
 * NdCarrierExpenses — модалка «Расходы перевозчика» (Отчёты → Перевозчики).
 * Произвольные удержания с привязкой к НЕДЕЛЕ УЧЁТА: вычитаются из суммы к
 * выплате до %СК (как штрафы), попадают только в баланс перевозчика и его
 * недельную выгрузку (отдельными строками на вкладке недели). Описание —
 * свободное; можно сохранить в шаблоны и потом выбирать из готовых.
 * Бэкенд: /api/carriers/balance/adjustments, /expense-presets.
 */
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../../api";
import { isoDate, money } from "../../lib/format";
import NdModal from "./NdModal";
import { shortDate as sd } from "./shared";

type Adjustment = { id: number; carrier_name: string; report_week: string; amount: number; description: string };
type Preset = { id: number; text: string };

function mondayIso(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDate(d);
}

function weekLabel(mondayIsoStr: string): string {
  const end = new Date(mondayIsoStr + "T00:00:00");
  end.setDate(end.getDate() + 6);
  return `${sd(mondayIsoStr)} – ${sd(isoDate(end))}`;
}

const EMPTY = { week: "", amount: "", description: "", savePreset: false };

export default function NdCarrierExpenses({ carrier, canEdit, onClose, onChanged }: {
  carrier: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Adjustment[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY, week: mondayIso(isoDate(new Date())) });

  async function load() {
    try {
      const [a, p] = await Promise.all([
        api.get<Adjustment[]>(`/api/carriers/balance/adjustments?carrier=${encodeURIComponent(carrier)}`),
        api.get<Preset[]>("/api/carriers/balance/expense-presets"),
      ]);
      setItems(a); setPresets(p);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось загрузить расходы");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [carrier]);   // eslint-disable-line react-hooks/exhaustive-deps

  const total = useMemo(() => items.reduce((s, a) => s + a.amount, 0), [items]);
  const amountNum = Number(String(form.amount).replace(",", ".").replace(/\s/g, ""));
  const valid = !!form.week && amountNum > 0 && form.description.trim().length > 0;

  function startEdit(a: Adjustment) {
    setEditId(a.id); setError(null);
    setForm({ week: a.report_week, amount: String(a.amount), description: a.description, savePreset: false });
  }
  function resetForm() {
    setEditId(null); setError(null);
    setForm({ ...EMPTY, week: form.week });
  }

  async function submit() {
    if (!valid) return;
    setBusy(true); setError(null);
    const body = { carrier_name: carrier, report_week: mondayIso(form.week), amount: amountNum,
                   description: form.description.trim(), save_preset: form.savePreset };
    try {
      if (editId) await api.put(`/api/carriers/balance/adjustments/${editId}`, body);
      else await api.post("/api/carriers/balance/adjustments", body);
      resetForm(); await load(); onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить");
    } finally { setBusy(false); }
  }

  async function remove(a: Adjustment) {
    if (!window.confirm(`Удалить расход «${a.description}» на ${money(a.amount)}?`)) return;
    setBusy(true); setError(null);
    try {
      await api.delete(`/api/carriers/balance/adjustments/${a.id}`);
      if (editId === a.id) resetForm();
      await load(); onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось удалить");
    } finally { setBusy(false); }
  }

  async function removePreset(p: Preset) {
    try { await api.delete(`/api/carriers/balance/expense-presets/${p.id}`); setPresets(ps => ps.filter(x => x.id !== p.id)); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Не удалось удалить шаблон"); }
  }

  return (
    <NdModal size="sheet" title="Расходы перевозчика" subtitle={`${carrier} · удержания по неделям учёта · итого ${money(total)}`}
      onClose={onClose}
      actions={[{ label: "Закрыть", kind: "primary", grow: true, onClick: onClose }]}>

      {canEdit && (
        <div className="cexp-form">
          <div className="cexp-form__row">
            <label className="field" style={{ flex: "0 0 170px" }}>
              <span className="field__label">Неделя учёта</span>
              <input type="date" className="field__input" value={form.week}
                onChange={e => setForm(f => ({ ...f, week: e.target.value }))} />
              {form.week && <span className="t-caption muted" style={{ marginTop: 4 }}>{weekLabel(mondayIso(form.week))}</span>}
            </label>
            <label className="field" style={{ flex: "0 0 150px" }}>
              <span className="field__label">Сумма, ₽</span>
              <input className="field__input" inputMode="decimal" placeholder="0" value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
            </label>
            <label className="field" style={{ flex: "1 1 240px" }}>
              <span className="field__label">Описание</span>
              <input className="field__input" list="cexp-presets" placeholder="Начните вводить или выберите шаблон"
                value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              <datalist id="cexp-presets">{presets.map(p => <option key={p.id} value={p.text} />)}</datalist>
            </label>
          </div>
          <div className="cexp-form__row" style={{ alignItems: "center" }}>
            <label className="cexp-check">
              <input type="checkbox" checked={form.savePreset}
                onChange={e => setForm(f => ({ ...f, savePreset: e.target.checked }))} />
              Сохранить описание в шаблоны
            </label>
            <div className="spacer" />
            {editId && <button type="button" className="btn btn--ghost" disabled={busy} onClick={resetForm}>Отмена</button>}
            <button type="button" className="btn btn--primary" disabled={!valid || busy} onClick={submit}>
              {busy ? "Сохранение…" : editId ? "Сохранить" : "+ Добавить расход"}
            </button>
          </div>
          {presets.length > 0 && (
            <div className="cexp-presets">
              <span className="t-caption muted">Шаблоны:</span>
              {presets.map(p => (
                <span key={p.id} className="cexp-chip">
                  <button type="button" className="cexp-chip__text" onClick={() => setForm(f => ({ ...f, description: p.text }))}>{p.text}</button>
                  <button type="button" className="cexp-chip__x" title="Удалить шаблон" aria-label={`Удалить шаблон ${p.text}`} onClick={() => removePreset(p)}>×</button>
                </span>
              ))}
            </div>
          )}
          {error && <div className="field__error">{error}</div>}
        </div>
      )}
      {!canEdit && error && <div className="field__error">{error}</div>}

      <div className="cexp-list">
        <div className="cexp-item cexp-item--head"><span>Неделя учёта</span><span>Описание</span><span>Сумма</span><span /></div>
        {loading ? (
          <div className="t-body-s muted" style={{ padding: "14px 0" }}>Загрузка…</div>
        ) : items.length === 0 ? (
          <div className="t-body-s muted" style={{ padding: "14px 0" }}>Расходов пока нет</div>
        ) : items.map(a => (
          <div key={a.id} className={"cexp-item" + (editId === a.id ? " is-editing" : "")}>
            <span className="cexp-item__week">{weekLabel(a.report_week)}</span>
            <span className="cexp-item__desc">{a.description}</span>
            <span className="cexp-item__sum">{money(a.amount)}</span>
            <span className="cexp-item__act">
              {canEdit && <>
                <button type="button" className="btn btn--ghost btn--xs" disabled={busy} onClick={() => startEdit(a)}>Изменить</button>
                <button type="button" className="btn btn--ghost btn--xs" disabled={busy} onClick={() => remove(a)}>Удалить</button>
              </>}
            </span>
          </div>
        ))}
      </div>
    </NdModal>
  );
}
