// Пончиковая диаграмма (Структура парка / любая разбивка по категориям).
// Портировано из design_handoff_fleet_dashboard/reference/fleet-components.jsx.
// 2026-06-26 (живой дашборд, задача #55): добавлены centerLabel/centerValue/
// valueFontSize, чтобы тот же компонент мог показать разбивку расходов по
// категориям (CashFlowEntry.category, деньги) не только "машин"/count -
// значения по умолчанию воспроизводят прежнее поведение, так что
// DashboardDemo.tsx (где это всё ещё count машин) не меняется.
export interface DonutSegment {
  name: string;
  count: number;
  color: string;
}

export default function Donut({
  segments,
  centerLabel = "машин",
  centerValue,
  valueFontSize = 26,
}: {
  segments: DonutSegment[];
  centerLabel?: string;
  centerValue?: string | number;
  valueFontSize?: number;
}) {
  const total = segments.reduce((s, x) => s + x.count, 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <svg width="128" height="128" viewBox="0 0 128 128" style={{ flex: "0 0 auto" }}>
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="16" />
        {segments.map((s, i) => {
          // total can be 0 for an empty period (e.g. no cashflow rows yet) -
          // guard against NaN dasharray instead of dividing by zero.
          const frac = total ? s.count / total : 0;
          const dash = frac * C;
          const el = (
            <circle
              key={i}
              cx="64"
              cy="64"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="16"
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              transform="rotate(-90 64 64)"
            />
          );
          offset += dash;
          return el;
        })}
        <text x="64" y="60" textAnchor="middle" className="num" fontSize={valueFontSize} fontWeight="600" fill="var(--ink)">
          {centerValue ?? total}
        </text>
        <text x="64" y="78" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--ink-3)">
          {centerLabel}
        </text>
      </svg>
      <div className="legend" style={{ flex: 1 }}>
        {segments.map((s, i) => (
          <div className="lg" key={i}>
            <span className="sw" style={{ background: s.color }} />
            <span>{s.name}</span>
            <span className="lv num">{s.count.toLocaleString("ru-RU")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
