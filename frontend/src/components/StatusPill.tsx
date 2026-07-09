// Портировано из design_handoff_fleet_dashboard/STARTER_TSX.md.
import type { VehicleStatus } from "../data/fleet";

const MAP: Record<VehicleStatus, { label: string; cls: string; dot: string }> = {
  route: { label: "В рейсе", cls: "st-route", dot: "var(--good)" },
  free: { label: "Свободно", cls: "st-free", dot: "var(--ink-3)" },
  service: { label: "На ТО", cls: "st-service", dot: "var(--warn)" },
};

export default function StatusPill({ status }: { status: VehicleStatus }) {
  const s = MAP[status];
  return (
    <span className={`status ${s.cls}`}>
      <span className="sd" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}
