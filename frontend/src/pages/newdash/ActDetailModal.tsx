/**
 * ActDetailModal — полный акт приёмки-сдачи (шаблон NdModal size="sheet").
 * Две колонки: приёмка (start_inspection) / сдача (end_inspection), строки
 * выровнены по общему чек-листу. Сводка расхождений, фотофиксация, комментарий.
 * Функционал старый: просмотр + принудительная сдача активной сессии.
 * Данные: GET /api/vehicle-inspections/sessions/{id}.
 */
import { useEffect, useState } from "react";
import { api, ApiError, fileUrl } from "../../api";
import NdModal from "./NdModal";
import { fmtDateTime } from "./shared";

type InspItem = { id: number; block: number; label: string; status: string; note: string; item_count: number | null };
type InspDamage = { id: number; description: string; photo_path: string };
type InspDetail = { id: number; kind: string; odometer: number | null; created_at: string; items: InspItem[]; damages: InspDamage[] };
type SessionDetail = {
  id: number; driver_id: number; driver_name: string;
  truck_id: number; truck_plate: string; truck_label: string;
  started_at: string; ended_at: string | null;
  start_inspection: InspDetail | null; end_inspection: InspDetail | null;
};

const BLOCK_NAMES: Record<number, string> = { 1: "Состояние авто", 2: "Документы", 3: "Комплектация", 4: "Чистота", 5: "Такелаж" };
const SIDES = ["Спереди", "Сзади", "Салон", "Одометр"];

const fmtDt = (iso: string | null) => fmtDateTime(iso);

function Mark({ status }: { status: string }) {
  if (status === "yes" || status === "clean") return <span className="mark mark--yes">ДА</span>;
  if (status === "no" || status === "dirty") return <span className="mark mark--no">НЕТ</span>;
  if (status === "medium") return <span className="mark mark--none">Средне</span>;
  return <span className="mark mark--none">—</span>;
}

function CheckRow({ label, item }: { label: string; item: InspItem | undefined }) {
  const note = item?.note || (item?.item_count != null ? `${item.item_count} шт.` : "");
  return (
    <div className="check-row">
      <span className="check-row__name">{label}{note && <span className="check-row__note"> {note}</span>}</span>
      <Mark status={item?.status ?? ""} />
    </div>
  );
}

export default function ActDetailModal({ sessionId, onClose, onForceClose }: {
  sessionId: number;
  onClose: () => void;
  onForceClose: (id: number) => void;
}) {
  const [d, setD] = useState<SessionDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<SessionDetail>(`/api/vehicle-inspections/sessions/${sessionId}`)
      .then(s => { if (alive) setD(s); })
      .catch(e => { if (alive) setErr(e instanceof ApiError ? e.message : "Ошибка загрузки"); });
    return () => { alive = false; };
  }, [sessionId]);

  // Загрузка / ошибка
  if (!d) {
    return (
      <NdModal size="sheet" title="Акт приёмки-сдачи" onClose={onClose}
        actions={[{ label: "Закрыть", kind: "ghost", grow: true, onClick: onClose }]}>
        <div className="t-body-s muted" style={{ padding: "24px 0", textAlign: "center" }}>{err || "Загрузка…"}</div>
      </NdModal>
    );
  }

  const start = d.start_inspection, end = d.end_inspection;
  const active = !d.ended_at;

  // Общий чек-лист: по блокам, объединение меток в порядке появления
  const blocks = [1, 2, 3, 4, 5].map(b => {
    const sItems = (start?.items || []).filter(i => i.block === b);
    const eItems = (end?.items || []).filter(i => i.block === b);
    const labels: string[] = [];
    const seen = new Set<string>();
    [...sItems, ...eItems].forEach(i => { if (!seen.has(i.label)) { seen.add(i.label); labels.push(i.label); } });
    const sMap: Record<string, InspItem> = {}; sItems.forEach(i => { sMap[i.label] = i; });
    const eMap: Record<string, InspItem> = {}; eItems.forEach(i => { eMap[i.label] = i; });
    return { block: b, labels, sMap, eMap };
  }).filter(b => b.labels.length);

  const noCount = (end?.items || []).filter(i => i.status === "no").length;
  const photoSrc = end || start;
  const sidePhotos = (photoSrc?.damages || []).filter(x => x.description.startsWith("4 стороны:"));
  const findSide = (s: string) => sidePhotos.find(x => x.description === `4 стороны: ${s}`);
  const comments = [...(end?.damages || []), ...(start?.damages || [])]
    .filter(x => !x.description.startsWith("Фото чистоты:") && !x.description.startsWith("4 стороны:") && x.description.trim());

  const col = (insp: InspDetail | null, side: "in" | "out") => (
    <div className={`act-col act-col--${side}`}>
      <div className="act-col__head">
        {side === "in" ? (
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="1.5" width="11" height="13" rx="2" /><path d="M5.5 5h5" /><path d="M5.5 8h5" /><path d="M5.5 11h3" /></svg>
        ) : (
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><circle cx="5.5" cy="8" r="3.2" /><path d="M8.7 8h5.3" /><path d="M12 8v2.6" /></svg>
        )}
        {side === "in" ? "Акт приёмки" : "Акт сдачи"}
      </div>
      <div className="t-body-s muted" style={{ padding: "10px 0 2px" }}>
        Одометр: <strong style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{insp?.odometer != null ? `${insp.odometer.toLocaleString("ru-RU")} км` : "не указан"}</strong>
      </div>
      {blocks.map(b => (
        <div className="act-group" key={b.block}>
          <div className="act-group__title t-mono-label">{BLOCK_NAMES[b.block]}</div>
          {b.labels.map(label => <CheckRow key={label} label={label} item={(side === "in" ? b.sMap : b.eMap)[label]} />)}
        </div>
      ))}
    </div>
  );

  return (
    <NdModal
      size="sheet"
      title="Акт приёмки-сдачи"
      onClose={onClose}
      headExtra={
        <div className="head-facts">
          <div><div className="head-facts__label">Водитель</div><div className="head-facts__value">{d.driver_name || `#${d.driver_id}`}</div></div>
          <div><div className="head-facts__label">Машина</div><div className="head-facts__value">{d.truck_plate}{d.truck_label && d.truck_label !== d.truck_plate ? <span className="muted" style={{ fontWeight: 400, fontSize: 12, fontFamily: "var(--font-mono)" }}> {d.truck_label}</span> : null}</div></div>
          <div><div className="head-facts__label">Статус</div><div className="head-facts__value"><span className={`status status--${active ? "warn" : "ok"}`}>{active ? "Активна" : "Завершена"}</span></div></div>
          <div><div className="head-facts__label">Принята</div><div className="head-facts__value" style={{ fontFamily: "var(--font-mono)" }}>{fmtDt(d.started_at)}</div></div>
          <div><div className="head-facts__label">Сдана</div><div className="head-facts__value" style={{ fontFamily: "var(--font-mono)" }}>{fmtDt(d.ended_at)}</div></div>
        </div>
      }
      actions={active
        ? [{ label: "Закрыть", kind: "ghost", onClick: onClose }, { label: "Принудительно сдать", kind: "accent", grow: true, onClick: () => onForceClose(d.id) }]
        : [{ label: "Закрыть", kind: "ghost", grow: true, onClick: onClose }]}
    >
      {noCount > 0 && (
        <div className="act-warn">
          <span className="dot dot--crit" />
          <span className="t-body" style={{ fontWeight: 500 }}>Не принято позиций: {noCount}</span>
          <span style={{ flex: 1 }} />
          <span className="t-body-s">требуется решение бригадира</span>
        </div>
      )}

      {/* Колонки акта — в белой карточке */}
      <section className="section" style={{ padding: "18px 20px 20px" }}>
        <div className="act-cols">
          {col(start, "in")}
          {col(end, "out")}
        </div>
      </section>

      {/* Фотофиксация */}
      <section className="section">
        <div className="t-mono-label section__title">Фотофиксация</div>
        <div className="photo-grid">
          {SIDES.map(s => {
            const ph = findSide(s);
            return ph ? (
              <a key={s} className="photo-slot is-done" href={fileUrl(`/photos/${ph.photo_path}`)} target="_blank" rel="noreferrer">
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="3.5" width="15" height="11" rx="2" /><circle cx="9" cy="9" r="3" /></svg>
                {s}
              </a>
            ) : (
              <div key={s} className="photo-slot">
                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect x="1.5" y="3.5" width="15" height="11" rx="2" /><circle cx="9" cy="9" r="3" /></svg>
                {s}
              </div>
            );
          })}
        </div>
      </section>

      {/* Комментарий / повреждения */}
      {comments.length > 0 && (
        <section className="section">
          <div className="t-mono-label section__title">Комментарий</div>
          {comments.map((c, i) => (
            <div key={`${c.id}-${i}`} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 8 }}>
              <div className="t-body" style={{ flex: 1, lineHeight: 1.5, color: "var(--text-2)" }}>{c.description}</div>
              {c.photo_path && <a href={fileUrl(`/photos/${c.photo_path}`)} target="_blank" rel="noreferrer" style={{ color: "var(--accent-ink)", flexShrink: 0 }}>📷</a>}
            </div>
          ))}
        </section>
      )}
    </NdModal>
  );
}
