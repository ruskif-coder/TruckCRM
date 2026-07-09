// Сглаженный area-график (Расход топлива). Портировано из
// design_handoff_fleet_dashboard/reference/fleet-components.jsx.
import { useRef, useState, type MouseEvent } from "react";
import { smoothPath } from "./smoothPath";

const fmtRub = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽`;
const fmtLiters = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} л`;

export default function AreaChart({
  values,
  volumes,
  peakIdx,
  peakLabel,
  labels,
}: {
  values: number[];
  // Литры по тем же неделям, что и values (2026-06-28) - опционально, чтобы
  // не ломать DashboardDemo.tsx, который этот проп не передаёт. Если задан -
  // подсказка при наведении показывает сумму и литры вместе.
  volumes?: number[];
  peakIdx: number;
  peakLabel: string;
  labels: string[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  // 2026-06-28: интерактивность по просьбе пользователя - наведение мышью
  // показывает сумму (и литры) за конкретную неделю вместо одной статичной
  // подсказки на пике. Когда курсор не над графиком, подсказка возвращается
  // к прежнему поведению (пик).
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const W = 520;
  const H = 150;
  const pad = 14;
  const max = Math.max(...values) * 1.15;
  const min = Math.min(...values) * 0.7;
  // 2026-06-26: guard against a flat all-equal series (e.g. all-zero fuel
  // weeks on a fresh live dashboard) - max-min would be 0, making every y a
  // divide-by-zero NaN instead of a flat line.
  const range = max - min || 1;
  const pts = values.map((v, i) => ({
    x: pad + (i / (values.length - 1 || 1)) * (W - pad * 2),
    y: H - pad - ((v - min) / range) * (H - pad * 2),
  }));
  const line = smoothPath(pts);
  const area = `${line} L ${pts[pts.length - 1].x} ${H} L ${pts[0].x} ${H} Z`;

  const activeIdx = hoverIdx ?? peakIdx;
  const active = pts[activeIdx];

  function handleMove(e: MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || pts.length === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let nearest = 0;
    let bestDist = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p.x - x);
      if (d < bestDist) {
        bestDist = d;
        nearest = i;
      }
    });
    setHoverIdx(nearest);
  }

  const badgeText =
    hoverIdx !== null
      ? volumes
        ? `${fmtRub(values[hoverIdx])} · ${fmtLiters(volumes[hoverIdx])}`
        : fmtRub(values[hoverIdx])
      : peakLabel;

  return (
    <div style={{ marginTop: 16, position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="150"
        preserveAspectRatio="none"
        style={{ display: "block", cursor: "crosshair" }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="fuelgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ink)" stopOpacity="0.14" />
            <stop offset="100%" stopColor="var(--ink)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#fuelgrad)" />
        <path d={line} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
        <line
          x1={active.x}
          y1={active.y}
          x2={active.x}
          y2={H}
          stroke="var(--ink-3)"
          strokeWidth="1.5"
          strokeDasharray="3 4"
          opacity="0.5"
        />
        <circle cx={active.x} cy={active.y} r="6" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2.5" />
      </svg>
      <div
        className="num"
        style={{
          position: "absolute",
          left: `${(active.x / W) * 100}%`,
          top: `${(active.y / H) * 150 - 34}px`,
          transform: "translateX(-50%)",
          background: "var(--accent)",
          color: "var(--accent-ink)",
          fontWeight: 700,
          fontSize: "0.78rem",
          padding: "4px 9px",
          borderRadius: 999,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {badgeText}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        {labels.map((l, i) => (
          <span
            key={i}
            style={{
              color: i === activeIdx ? "var(--ink)" : "var(--ink-3)",
              fontWeight: 600,
              fontSize: "0.74rem",
            }}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
