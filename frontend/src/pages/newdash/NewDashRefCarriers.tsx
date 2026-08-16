/**
 * NewDashRefCarriers — раздел «Справочники» → «Перевозчики» (/newdash/refs).
 * Порт CarriersTab из старой Directories.tsx: справочник перевозчиков с
 * реквизитами и привязкой к контрагенту. Функционал как есть, стили — .nd:
 * topbar → NdSectionTabs → NdDataTable, карточка через NdModal.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../api";
import NdMenu from "./NdMenu";
import NdSectionTabs, { REFS_TABS } from "./NdSectionTabs";
import NdSortReset from "./NdSortReset";
import NdFilters, { NdFilterButton } from "./NdFilters";
import NdPhoneHead from "./NdPhoneHead";
import NdModal from "./NdModal";
import NdDataTable from "./NdDataTable";
import type { Column } from "./NdDataTable";
import { NdField, NdSearch, useIsPhone } from "./shared";
import "./newdash.css";

type Carrier = {
  id: number; name: string; full_name: string; inn: string; phone: string; contact_person: string;
  ogrn: string; kpp: string; legal_address: string; bank_name: string; bik: string;
  settlement_account: string; correspondent_account: string; insurance_pct: number; counterparty_id: number | null;
};
type Counterparty = { id: number; name: string; inn: string; vat_rate: number };
type Row = Carrier & { cpName: string };

type FS = {
  name: string; full_name: string; inn: string; phone: string; contact_person: string;
  ogrn: string; kpp: string; legal_address: string; bank_name: string; bik: string;
  settlement_account: string; correspondent_account: string; insurance_pct: string; counterparty_id: number | null;
};
const EMPTY: FS = {
  name: "", full_name: "", inn: "", phone: "", contact_person: "",
  ogrn: "", kpp: "", legal_address: "", bank_name: "", bik: "",
  settlement_account: "", correspondent_account: "", insurance_pct: "", counterparty_id: null,
};
function toForm(c: Carrier): FS {
  return {
    name: c.name || "", full_name: c.full_name || "", inn: c.inn || "", phone: c.phone || "", contact_person: c.contact_person || "",
    ogrn: c.ogrn || "", kpp: c.kpp || "", legal_address: c.legal_address || "", bank_name: c.bank_name || "", bik: c.bik || "",
    settlement_account: c.settlement_account || "", correspondent_account: c.correspondent_account || "",
    insurance_pct: c.insurance_pct ? String(c.insurance_pct) : "", counterparty_id: c.counterparty_id ?? null,
  };
}
function toPayload(f: FS) {
  return { ...f, insurance_pct: f.insurance_pct ? Number(f.insurance_pct) : 0, counterparty_id: f.counterparty_id ?? null };
}

export default function NewDashRefCarriers() {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dense, setDense] = useState(true);
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});
  const isPhone = useIsPhone();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [editId, setEditId] = useState<number | null>(null);   // null закрыто, 0 новый, >0 правка
  const [form, setForm] = useState<FS>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function loadAll() {
    setLoading(true);
    Promise.all([api.get<Carrier[]>("/api/carriers/"), api.get<Counterparty[]>("/api/counterparties/")])
      .then(([c, cp]) => { setCarriers(c); setCounterparties(cp); setError(null); })
      .catch(e => setError(e instanceof ApiError ? e.message : "Ошибка загрузки"))
      .finally(() => setLoading(false));
  }
  useEffect(() => { loadAll(); }, []);

  const cpName = (id: number | null) => (id == null ? "" : counterparties.find(x => x.id === id)?.name || "");

  const rows: Row[] = useMemo(() => {
    const s = q.trim().toLowerCase();
    return carriers
      .map(c => ({ ...c, cpName: cpName(c.counterparty_id) }))
      .filter(r => !s || `${r.name} ${r.full_name} ${r.inn} ${r.phone} ${r.contact_person}`.toLowerCase().includes(s));
  }, [carriers, counterparties, q]);

  const setF = (k: keyof FS, v: string | number | null) => setForm(f => ({ ...f, [k]: v }));
  function openCreate() { setForm(EMPTY); setFormError(null); setEditId(0); }
  function openEdit(c: Carrier) { setForm(toForm(c)); setFormError(null); setEditId(c.id); }

  async function handleSave() {
    if (!form.name.trim()) { setFormError("Укажите название"); return; }
    setSaving(true); setFormError(null);
    try {
      const payload = toPayload(form);
      if (editId) await api.put(`/api/carriers/${editId}`, payload);
      else await api.post("/api/carriers/", payload);
      setEditId(null); loadAll();
    } catch (e) { setFormError(e instanceof ApiError ? e.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  }
  async function handleDelete() {
    if (!editId) return;
    if (!window.confirm("Удалить перевозчика?")) return;
    setSaving(true);
    try { await api.delete(`/api/carriers/${editId}`); setEditId(null); loadAll(); }
    catch (e) { setFormError(e instanceof ApiError ? e.message : "Ошибка удаления"); }
    finally { setSaving(false); }
  }

  const columns: Column<Row>[] = [
    { key: "name", label: "Название", type: "text", width: "minmax(150px, 1.2fr)", sticky: true, strong: true },
    { key: "full_name", label: "Полное наименование", type: "text", width: "minmax(180px, 1.6fr)", format: v => (v as string) || "—" },
    { key: "inn", label: "ИНН", type: "id", width: "130px", format: v => (v as string) || "—" },
    { key: "phone", label: "Телефон", type: "id", width: "140px", format: v => (v as string) || "—" },
    { key: "contact_person", label: "Контактное лицо", type: "text", width: "minmax(150px, 1fr)", format: v => (v as string) || "—" },
    { key: "insurance_pct", label: "% СК", type: "pct", width: "84px", format: v => ((v as number) ? `${v}%` : "—") },
    { key: "cpName", label: "Контрагент", type: "text", width: "minmax(140px, 1fr)", format: v => (v as string) || "—", cellTone: r => (r.cpName ? undefined : "mute") },
  ];

  return (
    <div className="nd">
      <NdMenu active="refs" />
      <main className="main">
        {isPhone ? (
          <>
            <NdPhoneHead title="Перевозчики" subtitle={`справочник · ${carriers.length}`} onAdd={openCreate} />
            <NdSectionTabs tabs={REFS_TABS} />
            <div className="nd-searchrow">
              <NdSearch value={q} onChange={setQ} placeholder="Название, ИНН, телефон…" />
              <NdFilterButton count={sorted ? 1 : 0} onClick={() => setFiltersOpen(true)} />
            </div>
          </>
        ) : (
          <>
            <header className="topbar">
              <div className="topbar__title">
                <h1 className="t-h1" style={{ margin: 0 }}>Перевозчики</h1>
                <span className="t-mono muted">справочник · {carriers.length}</span>
              </div>
              <div className="spacer" />
              <NdSearch value={q} onChange={setQ} placeholder="Название, ИНН, телефон…" />
            </header>
            <NdSectionTabs tabs={REFS_TABS} right={<>
              <button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Обычно" : "Компактно"}</button>
              <button className="btn btn--accent" onClick={openCreate}>Добавить перевозчика</button>
            </>} />
          </>
        )}

        <NdFilters open={filtersOpen} onClose={() => setFiltersOpen(false)} onReset={() => resetSortRef.current()} section="Перевозчики">
          <NdSortReset active={sorted} onReset={() => resetSortRef.current()} />
        </NdFilters>

        <div className={isPhone ? "nd-listwrap" : undefined} style={isPhone ? undefined : { flex: 1, minHeight: 0, padding: "12px 24px 20px", display: "flex", flexDirection: "column" }}>
          <NdDataTable<Row>
            columns={columns} rows={rows} loading={loading} dense={dense} rowId={r => r.id}
            onSortActive={setSorted} resetRef={resetSortRef}
            sortKey="name" sortDir={1} onRowClick={r => openEdit(r)}
            card={r => ({
              title: r.name,
              subtitle: r.full_name || undefined,
              collapsible: true,
              facts: [
                { label: "ИНН", value: r.inn || "—" },
                { label: "Телефон", value: r.phone || "—" },
                { label: "Контактное лицо", value: r.contact_person || "—" },
                { label: "% СК", value: r.insurance_pct ? `${r.insurance_pct}%` : "—" },
                { label: "Контрагент", value: r.cpName || "—" },
              ],
            })}
            empty={error ? "Не удалось загрузить" : "Перевозчиков нет"}
            emptyHint={error ? "Проверьте доступ" : "Добавьте первого перевозчика"}
          />
        </div>
      </main>

      {editId !== null && (
        <NdModal
          size="sheet"
          head="dark"
          title={editId ? (form.name || "Перевозчик") : "Новый перевозчик"}
          subtitle={editId ? "Карточка перевозчика" : "Заполните карточку"}
          avatar={(form.name[0] || "?").toUpperCase()}
          onClose={() => setEditId(null)}
          actions={[
            ...(editId ? [{ label: "Удалить", kind: "quiet" as const, onClick: handleDelete }] : []),
            { label: "Отмена", kind: "ghost", onClick: () => setEditId(null) },
            { label: saving ? "Сохранение…" : "Сохранить", kind: "accent", grow: true, disabled: saving, onClick: handleSave },
          ]}
        >
          <section className="section">
            <div className="t-mono-label section__title">Основное</div>
            <div className="form-grid">
              <NdField label="Название" v={form.name} on={v => setF("name", v)} />
              <NdField label="Полное наименование" v={form.full_name} on={v => setF("full_name", v)} />
              <NdField label="ИНН" v={form.inn} on={v => setF("inn", v)} />
              <NdField label="Телефон" v={form.phone} on={v => setF("phone", v)} />
              <NdField label="ФИО контактного лица" wide v={form.contact_person} on={v => setF("contact_person", v)} />
            </div>
          </section>

          <section className="section">
            <div className="t-mono-label section__title">Реквизиты</div>
            <div className="form-grid">
              <NdField label="ОГРН" v={form.ogrn} on={v => setF("ogrn", v)} />
              <NdField label="КПП" v={form.kpp} on={v => setF("kpp", v)} />
              <NdField label="Юридический адрес" wide v={form.legal_address} on={v => setF("legal_address", v)} />
              <NdField label="Банк" v={form.bank_name} on={v => setF("bank_name", v)} />
              <NdField label="БИК" v={form.bik} on={v => setF("bik", v)} />
              <NdField label="Расчётный счёт" v={form.settlement_account} on={v => setF("settlement_account", v)} />
              <NdField label="Корреспондентский счёт" v={form.correspondent_account} on={v => setF("correspondent_account", v)} />
            </div>
          </section>

          <section className="section">
            <div className="t-mono-label section__title">Условие и привязка</div>
            <div className="form-grid">
              <NdField label="% СК" type="number" v={form.insurance_pct} on={v => setF("insurance_pct", v)} />
              <div className="field">
                <span className="field__label">Контрагент (для баланса)</span>
                <select className="field__input" value={form.counterparty_id ?? ""} onChange={e => setF("counterparty_id", e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— не выбран —</option>
                  {counterparties.map(cp => <option key={cp.id} value={cp.id}>{cp.name}{cp.inn ? ` (ИНН ${cp.inn})` : ""}</option>)}
                </select>
              </div>
            </div>
          </section>

          {formError && <div className="field__error">{formError}</div>}
        </NdModal>
      )}
    </div>
  );
}
