// «Справочники» (2026-06-28, «наведём порядок» в навигации) — объединяет
// бывшие самостоятельные разделы «Автомобили» и «Водители», а также (с
// 2026-06-28, «перенеси перевозчики из настроек в справочники») вкладку
// «Перевозчики», ранее жившую в Настройки — логически это справочник
// наравне с машинами/водителями, не настройка. Шаблон тот же, что и у
// Settings.tsx (profile/users/roles) и Expenses.tsx (registry/fuel).
// Vehicles.tsx/Drivers.tsx не дублируются - переиспользуются как есть, их
// собственный pagehead уже убран (см. правки там же 2026-06-28), здесь
// рисуется только общий заголовок и переключатель вкладок. «Перевозчики» —
// самостоятельный компонент CarriersTab в этом же файле (перенесён без
// изменений из Settings.tsx, со своими локальными Row/SectionLabel/TextField
// хелперами формы, по тому же принципу, что и Drivers.tsx).
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import Icon from "../components/Icon";
import Vehicles from "./Vehicles";
import Drivers from "./Drivers";

type TabId = "vehicles" | "drivers" | "carriers" | "counterparties";
const TABS: { id: TabId; label: string }[] = [
  { id: "vehicles", label: "Автомобили" },
  { id: "drivers", label: "Водители" },
  { id: "carriers", label: "Перевозчики" },
  { id: "counterparties", label: "Контрагенты" },
];

export default function Directories() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<TabId>(() => {
    const t = searchParams.get("tab") as TabId;
    return TABS.some((x) => x.id === t) ? t : "vehicles";
  });

  // 2026-06-28 («выровнять вкладки и кнопки в одну строку») - переключатель
  // вкладок передаётся вниз как tabsNav вместо отдельной строки над
  // контентом, чтобы встать в одну строку с кнопками действий вкладки.
  const tabsNav = (
    <div className="navpills" style={{ width: "fit-content" }}>
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={"navpill" + (tab === t.id ? " active" : "")}
          style={{ border: "none", background: tab === t.id ? undefined : "none", cursor: "pointer", font: "inherit" }}
          onClick={() => setTab(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <div className="pagehead">
        <div className="ph-title">
          <div className="crumbs">
            <Icon name="grid" size={13} /> Автопарк <Icon name="chevr" size={13} /> Справочники
          </div>
          <h1 className="pagetitle">Справочники</h1>
        </div>
      </div>

      {tab === "vehicles" && <Vehicles tabsNav={tabsNav} />}
      {tab === "drivers" && <Drivers tabsNav={tabsNav} />}
      {tab === "carriers" && <CarriersTab tabsNav={tabsNav} />}
      {tab === "counterparties" && <CounterpartiesTab tabsNav={tabsNav} />}
    </div>
  );
}

// «Перевозчики» (перенесено 2026-06-28 из Настройки в Справочники). Код
// компонента и формы не менялся при переносе - только местоположение файла
// и хлебные крошки/заголовок раздела (теперь «Справочники», не «Настройки»).
type Carrier = {
  id: number;
  name: string;
  full_name: string;
  inn: string;
  phone: string;
  contact_person: string;
  ogrn: string;
  kpp: string;
  legal_address: string;
  bank_name: string;
  bik: string;
  settlement_account: string;
  correspondent_account: string;
  insurance_pct: number;
  counterparty_id: number | null;
};

type Counterparty = {
  id: number;
  name: string;
  inn: string;
  vat_rate: number;
};

type CarrierFormState = {
  name: string;
  full_name: string;
  inn: string;
  phone: string;
  contact_person: string;
  ogrn: string;
  kpp: string;
  legal_address: string;
  bank_name: string;
  bik: string;
  settlement_account: string;
  correspondent_account: string;
  insurance_pct: string;
  counterparty_id: number | null;
};

const EMPTY_CARRIER_FORM: CarrierFormState = {
  name: "",
  full_name: "",
  inn: "",
  phone: "",
  contact_person: "",
  ogrn: "",
  kpp: "",
  legal_address: "",
  bank_name: "",
  bik: "",
  settlement_account: "",
  correspondent_account: "",
  insurance_pct: "",
  counterparty_id: null,
};

function carrierToForm(c: Carrier): CarrierFormState {
  return {
    name: c.name || "",
    full_name: c.full_name || "",
    inn: c.inn || "",
    phone: c.phone || "",
    contact_person: c.contact_person || "",
    ogrn: c.ogrn || "",
    kpp: c.kpp || "",
    legal_address: c.legal_address || "",
    bank_name: c.bank_name || "",
    bik: c.bik || "",
    settlement_account: c.settlement_account || "",
    correspondent_account: c.correspondent_account || "",
    insurance_pct: c.insurance_pct ? String(c.insurance_pct) : "",
    counterparty_id: c.counterparty_id ?? null,
  };
}

function carrierToPayload(f: CarrierFormState) {
  return {
    ...f,
    insurance_pct: f.insurance_pct ? Number(f.insurance_pct) : 0,
    counterparty_id: f.counterparty_id ?? null,
  };
}

function CarriersTab({ tabsNav }: { tabsNav?: ReactNode }) {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CarrierFormState>(EMPTY_CARRIER_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [c, cp] = await Promise.all([
        api.get<Carrier[]>("/api/carriers/"),
        api.get<Counterparty[]>("/api/counterparties/"),
      ]);
      setCarriers(c);
      setCounterparties(cp);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_CARRIER_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(c: Carrier) {
    setEditingId(c.id);
    setForm(carrierToForm(c));
    setFormError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  function setFieldValue<K extends keyof CarrierFormState>(key: K, value: CarrierFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setFormError("Укажите название");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = carrierToPayload(form);
      if (editingId) {
        await api.put(`/api/carriers/${editingId}`, payload);
      } else {
        await api.post("/api/carriers/", payload);
      }
      setModalOpen(false);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingId) return;
    if (!window.confirm("Удалить перевозчика?")) return;
    setSaving(true);
    setFormError(null);
    try {
      await api.delete(`/api/carriers/${editingId}`);
      setModalOpen(false);
      await loadAll();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Ошибка удаления");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* 2026-06-28: кнопка «Добавить перевозчика» объединена в одну строку с
          переключателем вкладок (tabsNav), как и в остальных вкладках, чтобы
          не было двух строк подряд (вкладки сверху, кнопка ниже). */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabsNav}
        <button className="pill-btn solid" onClick={openCreate}>
          <Icon name="plus" size={17} /> <span className="lbl-hide">Добавить перевозчика</span>
        </button>
      </div>

      {error && (
        <p className="fcard" style={{ color: "var(--ember)", marginBottom: 24 }}>
          {error}
        </p>
      )}

      <div className="fcard" style={{ padding: 0 }}>
        {loading ? (
          <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>Загрузка...</p>
        ) : carriers.length === 0 ? (
          <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>Пока нет перевозчиков. Добавьте первого.</p>
        ) : (
          <div style={{ overflowX: "auto", padding: "16px 20px" }}>
            <table>
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Полное наименование</th>
                  <th>ИНН</th>
                  <th>Телефон</th>
                  <th>Контактное лицо</th>
                  <th>% СК</th>
                  <th>Контрагент</th>
                </tr>
              </thead>
              <tbody>
                {carriers.map((c) => {
                  const cp = counterparties.find((x) => x.id === c.counterparty_id);
                  return (
                    <tr key={c.id} onClick={() => openEdit(c)} style={{ cursor: "pointer" }}>
                      <td>{c.name}</td>
                      <td>{c.full_name || "—"}</td>
                      <td>{c.inn || "—"}</td>
                      <td>{c.phone || "—"}</td>
                      <td>{c.contact_person || "—"}</td>
                      <td>{c.insurance_pct ? `${c.insurance_pct}%` : "—"}</td>
                      <td style={{ color: cp ? undefined : "var(--ink-3)" }}>{cp ? cp.name : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="modal-overlay">
          <div className="fcard" style={{ width: 640, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", padding: 0 }}>
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
              <h2 style={{ fontSize: 18, margin: 0 }}>{editingId ? "Карточка перевозчика" : "Новый перевозчик"}</h2>
              <button
                type="button"
                onClick={closeModal}
                style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: 24 }}>
              <Row>
                <TextField label="Название" value={form.name} onChange={(v) => setFieldValue("name", v)} />
                <TextField label="Полное наименование" value={form.full_name} onChange={(v) => setFieldValue("full_name", v)} />
              </Row>

              <Row>
                <TextField label="ИНН" value={form.inn} onChange={(v) => setFieldValue("inn", v)} />
              </Row>

              <Row>
                <TextField label="Телефон" value={form.phone} onChange={(v) => setFieldValue("phone", v)} />
              </Row>
              <Row>
                <TextField label="ФИО контактного лица" value={form.contact_person} onChange={(v) => setFieldValue("contact_person", v)} />
              </Row>

              <SectionLabel>Реквизиты</SectionLabel>

              <Row>
                <TextField label="ОГРН" value={form.ogrn} onChange={(v) => setFieldValue("ogrn", v)} />
                <TextField label="КПП" value={form.kpp} onChange={(v) => setFieldValue("kpp", v)} />
              </Row>
              <Row>
                <TextField label="Юридический адрес" value={form.legal_address} onChange={(v) => setFieldValue("legal_address", v)} />
              </Row>
              <Row>
                <TextField label="Банк" value={form.bank_name} onChange={(v) => setFieldValue("bank_name", v)} />
                <TextField label="БИК" value={form.bik} onChange={(v) => setFieldValue("bik", v)} />
              </Row>
              <Row>
                <TextField label="Расчётный счёт" value={form.settlement_account} onChange={(v) => setFieldValue("settlement_account", v)} />
                <TextField label="Корреспондентский счёт" value={form.correspondent_account} onChange={(v) => setFieldValue("correspondent_account", v)} />
              </Row>

              <Row>
                <TextField label="% СК" type="number" value={form.insurance_pct} onChange={(v) => setFieldValue("insurance_pct", v)} />
              </Row>

              <Row>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <label className="label">Контрагент (для баланса)</label>
                  <select
                    className="input"
                    value={form.counterparty_id ?? ""}
                    onChange={(e) =>
                      setFieldValue("counterparty_id", e.target.value ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">— не выбран —</option>
                    {counterparties.map((cp) => (
                      <option key={cp.id} value={cp.id}>
                        {cp.name}{cp.inn ? ` (ИНН ${cp.inn})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </Row>

              {formError && <p style={{ color: "var(--ember)", fontSize: 13, margin: "0 0 12px" }}>{formError}</p>}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  {editingId && (
                    <button
                      type="button"
                      className="pill-btn"
                      style={{ color: "var(--bad-ink)" }}
                      disabled={saving}
                      onClick={handleDelete}
                    >
                      Удалить
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className="pill-btn" onClick={closeModal}>
                    Отмена
                  </button>
                  <button type="button" className="pill-btn solid" disabled={saving} onClick={handleSave}>
                    {saving ? "Сохранение..." : "Сохранить"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>{children}</div>;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: ".04em", margin: "0 0 12px" }}>
      {children}
    </p>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 160 }}>
      <label className="label">{label}</label>
      <input type={type} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ─── Контрагенты ─────────────────────────────────────────────────────────────
// Добавлено 2026-07-12: справочник контрагентов с подсветкой незаполненных
// (пустой ИНН → красная строка «Требует дозаполнения»). Контрагент может
// быть создан «на лету» со страницы Расходов (только с названием); здесь
// диспетчер дозаполняет ИНН и НДС.
type CounterpartyFormState = { name: string; inn: string; vat_rate: string };
const EMPTY_CP_FORM: CounterpartyFormState = { name: "", inn: "", vat_rate: "" };

function CounterpartiesTab({ tabsNav }: { tabsNav?: ReactNode }) {
  const [list, setList] = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CounterpartyFormState>(EMPTY_CP_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true); setError(null);
    try { setList(await api.get<Counterparty[]>("/api/counterparties/")); }
    catch (err) { setError(err instanceof ApiError ? err.message : "Ошибка загрузки"); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadAll(); }, []);

  function openCreate() {
    setEditingId(null); setForm(EMPTY_CP_FORM); setFormError(null); setModalOpen(true);
  }
  function openEdit(cp: Counterparty) {
    setEditingId(cp.id);
    setForm({ name: cp.name || "", inn: cp.inn || "", vat_rate: cp.vat_rate ? String(cp.vat_rate) : "" });
    setFormError(null); setModalOpen(true);
  }
  function closeModal() { setModalOpen(false); }
  function setF<K extends keyof CounterpartyFormState>(key: K, v: CounterpartyFormState[K]) {
    setForm((f) => ({ ...f, [key]: v }));
  }

  async function handleSave() {
    if (!form.name.trim()) { setFormError("Укажите название"); return; }
    setSaving(true); setFormError(null);
    try {
      const payload = { name: form.name.trim(), inn: form.inn.trim(), vat_rate: form.vat_rate ? Number(form.vat_rate) : 0 };
      if (editingId) await api.put(`/api/counterparties/${editingId}`, payload);
      else await api.post("/api/counterparties/", payload);
      setModalOpen(false); await loadAll();
    } catch (err) { setFormError(err instanceof ApiError ? err.message : "Ошибка сохранения"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!editingId) return;
    if (!window.confirm("Удалить контрагента?")) return;
    setSaving(true); setFormError(null);
    try { await api.delete(`/api/counterparties/${editingId}`); setModalOpen(false); await loadAll(); }
    catch (err) { setFormError(err instanceof ApiError ? err.message : "Ошибка удаления"); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabsNav}
        <button className="pill-btn solid" onClick={openCreate}>
          <Icon name="plus" size={17} /> <span className="lbl-hide">Добавить контрагента</span>
        </button>
      </div>

      {error && <p className="fcard" style={{ color: "var(--ember)", marginBottom: 24 }}>{error}</p>}

      <div className="fcard" style={{ padding: 0 }}>
        {loading ? (
          <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>Загрузка...</p>
        ) : list.length === 0 ? (
          <p style={{ color: "var(--ink-3)", padding: "20px 24px" }}>Нет контрагентов. Добавьте первого.</p>
        ) : (
          <div style={{ overflowX: "auto", padding: "16px 20px" }}>
            <table>
              <thead>
                <tr>
                  <th>Название</th>
                  <th>ИНН</th>
                  <th>НДС %</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {list.map((cp) => {
                  const incomplete = !cp.inn;
                  return (
                    <tr
                      key={cp.id}
                      onClick={() => openEdit(cp)}
                      style={{ cursor: "pointer", background: incomplete ? "rgba(224,4,4,.04)" : undefined }}
                    >
                      <td style={{ color: incomplete ? "var(--ember,#e04)" : undefined, fontWeight: incomplete ? 600 : undefined }}>
                        {cp.name}
                      </td>
                      <td style={{ color: incomplete ? "var(--ember,#e04)" : undefined }}>
                        {cp.inn || "—"}
                      </td>
                      <td>{cp.vat_rate ? `${cp.vat_rate}%` : "—"}</td>
                      <td style={{ fontSize: 12, color: incomplete ? "var(--ember,#e04)" : "var(--ok,#27ae60)" }}>
                        {incomplete ? "Требует дозаполнения" : "Заполнен"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="modal-overlay">
          <div className="fcard" style={{ width: 480, maxWidth: "94vw", padding: 0 }}>
            <div style={{ background: "var(--dark)", color: "#fff", padding: "16px 24px", borderRadius: "26px 26px 0 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: 18, margin: 0 }}>{editingId ? "Редактировать контрагента" : "Новый контрагент"}</h2>
              <button type="button" onClick={closeModal} style={{ background: "none", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: 24 }}>
              <Row><TextField label="Название" value={form.name} onChange={(v) => setF("name", v)} /></Row>
              <Row><TextField label="ИНН" value={form.inn} onChange={(v) => setF("inn", v)} /></Row>
              <Row><TextField label="НДС %" type="number" value={form.vat_rate} onChange={(v) => setF("vat_rate", v)} /></Row>

              {!form.inn.trim() && (
                <p style={{ fontSize: 12, color: "var(--ember,#e04)", margin: "-8px 0 16px" }}>
                  Контрагент без ИНН помечается как незаполненный
                </p>
              )}

              {formError && <p style={{ color: "var(--ember)", fontSize: 13, margin: "0 0 12px" }}>{formError}</p>}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  {editingId && (
                    <button type="button" className="pill-btn" style={{ color: "var(--bad-ink)" }} disabled={saving} onClick={handleDelete}>
                      Удалить
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className="pill-btn" onClick={closeModal}>Отмена</button>
                  <button type="button" className="pill-btn solid" disabled={saving} onClick={handleSave}>
                    {saving ? "Сохранение..." : "Сохранить"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
