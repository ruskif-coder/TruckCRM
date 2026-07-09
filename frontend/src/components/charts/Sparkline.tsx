// Спарклайн (Пробег за неделю). Портировано из
// design_handoff_fleet_dashboard/reference/fleet-components.jsx.
import { smoothPath } from "./smoothPath";

export default function Sparkline({ values }: { values: number[] }) {
  const W = 260;
  const H = 50;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * W,
    y: H - ((v - min) / (max - min || 1)) * (H - 8) - 4,
  }));
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      <path d={smoothPath(pts)} fill="none" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={last.x - 2} cy={last.y} r="4.5" fill="var(--accent)" stroke="var(--surface-2)" strokeWidth="2" />
    </svg>
  );
}
