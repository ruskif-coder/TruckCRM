/**
 * NewDashCounterparties — раздел «Справочники» → «Контрагенты» (/newdash/refs/counterparties).
 * Порт CounterpartiesTab из старой Directories.tsx: справочник контрагентов с
 * подсветкой незаполненных (пустой ИНН → «Требует дозаполнения»). Стили — .nd.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import NdMenu from "./NdMenu";
import NdSectionTabs, { REFS_TABS } from "./NdSectionTabs";
import NdSortReset from "./NdSortReset";
import NdModal from "./NdModal";
import NdDataTable from "./NdDataTable";
import type { Column } from "./NdDataTable";
import { NdSearch } from "./shared";
import "./newdash.css";

type Counterparty = { id: number; name: string; inn: string; vat_rate: number };
type FS = { name: string; inn: string; vat_rate: string };
const EMPTY: FS = { name: "", inn: "", vat_rate: "" };

export default function NewDashCounterparties() {
  const [list, setList] = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dense, setDense] = useState(true);
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});

  const [editId, setEditId] = useState<number | null>(null);   // null закрыто, 0 новый, >0 правка
  const [form, setForm] = useState<FS>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function loadAll() {
    setLoading(true);
    api.get<Counterparty[]>("/api/counterparties/")
      .then(d => { setList(d); setError(null); })
      .catch(e => setError(e instanceof ApiError ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { loadAll(); }, []);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return list.filter(cp => !s || `${cp.name} ${cp.inn}`.toLowerCase().includes(s));
  }, [list, q]);

  const setF = (k: keyof FS, v: string) => setForm(f => ({ ...f, [k]: v }));
  function openCreate() { setForm(EMPTY); setFormError(null); setEditId(0); }
  function openEdit(cp: Counterparty) { setForm({ name: cp.name || "", inn: cp.inn || "", vat_rate: cp.vat_rate ? String(cp.vat_rate) : "" }); setFormError(null); setEditId(cp.id); }

  async function handleSave() {
    if (!form.name.trim()) { setFormError("Укажите название"); return; }
    setSaving(true); setFormError(null);
    try {
      const payload = { name: form.name.trim(), inn: form.inn.trim(), vat_rate: form.vat_rate ? Number(form.vat_rate) : 0 };
      if (editId) await api.put(`/api/counterparties/${editId}`, payload);
      else await api.post("/api/counterparties/", payload);
      setEditId(null); loadAll();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  }
  async function handleDelete() {
    if (!editId) return;
    if (!window.confirm("Удалить контрагента?")) return;
    setSaving(true);
    try { await api.delete(`/api/counterparties/${editId}`); setEditId(null); loadAll(); }
    catch (e) { setFormError(e instanceof ApiError ? e.message : "Ошибка удаления"); }
    finally { setSaving(false); }
  }

  const columns: Column<Counterparty>[] = [
    { key: "name", label: "Название", type: "text", width: "minmax(200px, 1.6fr)", sticky: true, strong: true, cellTone: r => (r.inn ? undefined : "neg") },
    { key: "inn", label: "ИНН", type: "id", width: "160px", format: v => (v as string) || "—", cellTone: r => (r.inn ? undefined : "neg") },
    { key: "vat_rate", label: "НДС %", type: "pct", width: "110px", format: v => ((v as number) ? `${v}%` : "—") },
    { key: "status", label: "Статус", type: "text", width: "minmax(180px, 1fr)", sortValue: r => (r.inn ? 1 : 0),
      render: r => <span className={"status status--" + (r.inn ? "ok" : "risk")}>{r.inn ? "Заполнен" : "Требует дозаполнения"}</span> },
  ];

  return (
    <div className="nd">
      <NdMenu active="refs" />
      <main className="main">
        <header className="topbar">
          <div className="topbar__title">
            <h1 className="t-h1" style={{ margin: 0 }}>Контрагенты</h1>
            <span className="t-mono muted">справочник · {list.length}</span>
          </div>
          <div className="spacer" />
          <NdSearch value={q} onChange={setQ} placeholder="Название, ИНН…" />
        </header>

        <NdSectionTabs tabs={REFS_TABS} right={<>
          <button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Обычно" : "Компактно"}</button>
          <button className="btn btn--accent" onClick={openCreate}>Добавить контрагента</button>
        </>} />

        <div className="filterbar">
          <NdSortReset active={sorted} onReset={() => resetSortRef.current()} />
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: "12px 24px 20px", display: "flex", flexDirection: "column" }}>
          <NdDataTable<Counterparty>
            columns={columns} rows={rows} loading={loading} dense={dense} rowId={r => r.id}
            onSortActive={setSorted} resetRef={resetSortRef}
            sortKey="name" sortDir={1} onRowClick={r => openEdit(r)}
            empty={error ? "Не удалось загрузить" : "Контрагентов нет"}
            emptyHint={error ? "Проверьте доступ" : "Добавьте первого контрагента"}
          />
        </div>
      </main>

      {editId !== null && (
        <NdModal
          size="form"
          title={editId ? "Редактировать контрагента" : "Новый контрагент"}
          subtitle={editId ? form.name : "Заполните карточку"}
          onClose={() => setEditId(null)}
          actions={[
            ...(editId ? [{ label: "Удалить", kind: "quiet" as const, onClick: handleDelete }] : []),
            { label: "Отмена", kind: "ghost", onClick: () => setEditId(null) },
            { label: saving ? "Сохранение…" : "Сохранить", kind: "accent", grow: true, disabled: saving, onClick: handleSave },
          ]}
        >
          <div className="field"><span className="field__label">Название</span>
            <input className="field__input" value={form.name} onChange={e => setF("name", e.target.value)} /></div>
          <div className="field" style={{ marginTop: 12 }}><span className="field__label">ИНН</span>
            <input className="field__input" value={form.inn} onChange={e => setF("inn", e.target.value)} /></div>
          <div className="field" style={{ marginTop: 12 }}><span className="field__label">НДС %</span>
            <input type="number" className="field__input" value={form.vat_rate} onChange={e => setF("vat_rate", e.target.value)} /></div>
          {!form.inn.trim() && <div className="t-caption" style={{ color: "var(--danger)", marginTop: 8 }}>Контрагент без ИНН помечается как незаполненный.</div>}
          {formError && <div className="field__error" style={{ marginTop: 10 }}>{formError}</div>}
        </NdModal>
      )}
    </div>
  );
}
