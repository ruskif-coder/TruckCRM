/**
 * NewDashClaims — раздел «Финансы» → «Заявки» (/newdash/finance/claims).
 * Заявки на компенсацию: журнал на шаблоне NdDataTable, просмотр с фото,
 * одобрение / отклонение. Данные: /api/compensation-requests/journal/.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, fileUrl } from "../../api";
import { fmtDate, money, uniqueSorted } from "../../lib/format";
import NdMenu from "./NdMenu";
import NdSectionTabs, { FINANCE_TABS } from "./NdSectionTabs";
import NdMultiSelect from "./NdMultiSelect";
import NdSortReset from "./NdSortReset";
import NdFilters, { NdFilterButton } from "./NdFilters";
import NdPhoneHead from "./NdPhoneHead";
import NdModal from "./NdModal";
import NdDataTable from "./NdDataTable";
import type { Column } from "./NdDataTable";
import { fmtDateTime, NdSearch, useIsPhone } from "./shared";
import "./newdash.css";

type Claim = {
  id: number; driver_id: number | null; truck_id: number | null;
  expense_date: string; amount: number; category: string; description: string; photo_paths: string;
  status: string; reject_reason: string; created_at: string;
  driver_name: string; truck_label: string; approved_by_username: string | null;
};

const PENDING = "на рассмотрении";
const statusTone = (s: string) => s === PENDING ? "warn" : s.includes("отказ") ? "risk" : "ok";

export default function NewDashClaims() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [dense, setDense] = useState(true);
  const [statusF, setStatusF] = useState<Set<string>>(new Set());
  const [sorted, setSorted] = useState(false);
  const resetSortRef = useRef<() => void>(() => {});
  const isPhone = useIsPhone();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeCount = (statusF.size ? 1 : 0) + (sorted ? 1 : 0);
  const resetAllFilters = () => { setStatusF(new Set()); resetSortRef.current(); };

  const [view, setView] = useState<Claim | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  function loadAll() {
    setLoading(true);
    api.get<Claim[]>("/api/compensation-requests/journal/").then(c => { setClaims(c); setError(null); }).catch(e => setError(e instanceof ApiError ? e.message : "Ошибка загрузки")).finally(() => setLoading(false));
  }
  useEffect(() => { loadAll(); }, []);

  const statusOptions = useMemo(() => uniqueSorted(claims.map(c => c.status || "—")), [claims]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return claims.filter(c => {
      if (statusF.size && !statusF.has(c.status)) return false;
      if (s && !`${c.driver_name} ${c.truck_label} ${c.category} ${c.description}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [claims, q, statusF]);

  const pendingCount = claims.filter(c => c.status === PENDING).length;

  async function approve(id: number) {
    setBusy(true);
    try { await api.post(`/api/compensation-requests/${id}/approve`, {}); setView(null); loadAll(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка"); } finally { setBusy(false); }
  }
  async function reject(id: number) {
    setBusy(true);
    try { await api.post(`/api/compensation-requests/${id}/reject`, { reason: rejectReason }); setRejecting(false); setRejectReason(""); setView(null); loadAll(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка"); } finally { setBusy(false); }
  }

  const columns: Column<Claim>[] = [
    { key: "created_at", label: "Дата", type: "date", width: "148px", sticky: true, strong: true, format: v => fmtDateTime(v) },
    { key: "amount", label: "Сумма", type: "money", width: "128px" },
    { key: "driver_name", label: "Водитель", type: "text", width: "minmax(160px, 1fr)" },
    { key: "truck_label", label: "Машина", type: "id", width: "116px" },
    { key: "category", label: "Статья", type: "text", width: "150px" },
    { key: "expense_date", label: "Дата расхода", type: "date", width: "128px", format: v => fmtDate(v as string) },
    { key: "status", label: "Статус", type: "status", width: "160px", tone: r => statusTone(r.status) },
  ];

  const photos = (c: Claim): string[] => { try { return JSON.parse(c.photo_paths || "[]"); } catch { return []; } };

  return (
    <div className="nd">
      <NdMenu active="finance" />
      <main className="main">
        {isPhone ? (
          <>
            <NdPhoneHead title="Заявки" subtitle={`всего · ${claims.length}${pendingCount ? ` · ${pendingCount} на рассм.` : ""}`} />
            <NdSectionTabs tabs={FINANCE_TABS} />
            <div className="nd-searchrow">
              <NdSearch value={q} onChange={setQ} placeholder="Водитель, машина, статья…" />
              <NdFilterButton count={activeCount} onClick={() => setFiltersOpen(true)} />
            </div>
          </>
        ) : (
          <>
            <header className="topbar">
              <div className="topbar__title"><h1 className="t-h1" style={{ margin: 0 }}>Заявки на компенсацию</h1><span className="t-mono muted">всего · {claims.length}{pendingCount ? ` · ${pendingCount} на рассмотрении` : ""}</span></div>
              <div className="spacer" />
              <NdSearch value={q} onChange={setQ} placeholder="Водитель, машина, статья…" />
            </header>
            <NdSectionTabs tabs={FINANCE_TABS} right={
              <button className="btn btn--ghost" onClick={() => setDense(d => !d)}>{dense ? "Обычно" : "Компактно"}</button>
            } />
          </>
        )}

        <NdFilters open={filtersOpen} onClose={() => setFiltersOpen(false)} onReset={resetAllFilters} section="Заявки">
          <NdMultiSelect label="Статус" options={statusOptions} selected={statusF} onChange={setStatusF} />
          <NdSortReset active={sorted} onReset={() => resetSortRef.current()} />
        </NdFilters>

        <div className={isPhone ? "nd-listwrap" : undefined} style={isPhone ? undefined : { flex: 1, minHeight: 0, padding: "12px 24px 20px", display: "flex", flexDirection: "column" }}>
          <NdDataTable<Claim>
            columns={columns} rows={rows} loading={loading} dense={dense}
            onSortActive={setSorted} resetRef={resetSortRef}
            sortKey="created_at" sortDir={-1} rowId={r => r.id}
            onRowClick={c => { setRejecting(false); setRejectReason(""); setView(c); }}
            card={c => ({
              title: <>Заявка · {money(c.amount)}<span className={`status status--${statusTone(c.status)}`} style={{ marginLeft: 6 }}>{c.status}</span></>,
              subtitle: c.driver_name,
              collapsible: true,
              facts: [
                { label: "Машина", value: c.truck_label || "—" },
                { label: "Статья", value: c.category || "—" },
                { label: "Дата расхода", value: c.expense_date ? fmtDate(c.expense_date) : "—" },
                { label: "Создана", value: fmtDateTime(c.created_at) },
              ],
              actions: <button type="button" className="btn btn--primary" style={{ width: "100%" }} onClick={() => { setRejecting(false); setRejectReason(""); setView(c); }}>Открыть заявку</button>,
            })}
            empty={error ? "Не удалось загрузить" : "Заявок нет"} emptyHint={error ? "Проверьте доступ" : "Заявки создают водители из мобильного кабинета"}
          />
        </div>
      </main>

      {view && (
        <NdModal
          size="panel" head="dark"
          title={view.driver_name || "Заявка"}
          subtitle={`Компенсация · ${money(view.amount)}`}
          avatar="₽"
          status={{ label: view.status, tone: statusTone(view.status) as "ok" | "warn" | "risk" | "idle" }}
          onClose={() => setView(null)}
          actions={view.status === PENDING && !rejecting
            ? [
                { label: "Отклонить", kind: "ghost", onClick: () => setRejecting(true) },
                { label: busy ? "…" : "Одобрить", kind: "accent", grow: true, disabled: busy, onClick: () => approve(view.id) },
              ]
            : rejecting
              ? [{ label: "Назад", kind: "ghost", onClick: () => setRejecting(false) }, { label: busy ? "…" : "Отклонить заявку", kind: "accent", grow: true, disabled: busy, onClick: () => reject(view.id) }]
              : [{ label: "Закрыть", kind: "ghost", grow: true, onClick: () => setView(null) }]}
        >
          <section className="section">
            <div className="facts">
              <div className="facts__row"><span className="facts__label">Машина</span><span className="facts__value">{view.truck_label || "—"}</span></div>
              <div className="facts__row"><span className="facts__label">Статья</span><span className="facts__value">{view.category || "—"}</span></div>
              <div className="facts__row"><span className="facts__label">Сумма</span><span className="facts__value">{money(view.amount)}</span></div>
              <div className="facts__row"><span className="facts__label">Дата расхода</span><span className="facts__value">{fmtDate(view.expense_date)}</span></div>
              <div className="facts__row"><span className="facts__label">Создана</span><span className="facts__value">{fmtDateTime(view.created_at)}</span></div>
              {view.approved_by_username && <div className="facts__row"><span className="facts__label">Решение принял</span><span className="facts__value">{view.approved_by_username}</span></div>}
            </div>
          </section>

          {view.description && <section className="section"><div className="t-mono-label section__title">Комментарий</div><div className="t-body" style={{ color: "var(--text-2)", lineHeight: 1.5 }}>{view.description}</div></section>}

          {photos(view).length > 0 && (
            <section className="section">
              <div className="t-mono-label section__title">Фото</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                {photos(view).map((p, i) => (
                  <a key={i} href={fileUrl(`/photos/${p}`)} target="_blank" rel="noreferrer" style={{ display: "block", height: 90, borderRadius: "var(--r-lg)", overflow: "hidden", border: "1px solid var(--line)" }}>
                    <img src={fileUrl(`/photos/${p}`)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </a>
                ))}
              </div>
            </section>
          )}

          {view.status.includes("отказ") && view.reject_reason && (
            <div className="act-warn"><span className="dot dot--crit" />Причина отказа: {view.reject_reason}</div>
          )}

          {rejecting && (
            <section className="section">
              <div className="field"><span className="field__label">Причина отказа</span><textarea rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Почему заявка отклонена" /></div>
            </section>
          )}
        </NdModal>
      )}
    </div>
  );
}
