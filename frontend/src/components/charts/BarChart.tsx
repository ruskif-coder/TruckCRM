// Столбчатая диаграмма (Рейсы за неделю). Портировано из
// design_handoff_fleet_dashboard/reference/fleet-components.jsx.
// 2026-07-07: добавлен hover — при наведении подсвечивается бар под курсором,
// иначе подсвечивается бар с hi=true (последняя неделя от бэка).
import { useState } from "react";

export interface BarChartDay {
  d: string;
  v: number;
  hi?: boolean;
}

export default function BarChart({ days }: { days: BarChartDay[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  // 2026-06-26: guard against an all-zero week range (e.g. a fresh live
  // dashboard with no trips yet) - Math.max(...) would be 0, making d.v/max
  // a NaN height instead of a flat empty chart.
  const max = Math.max(1, ...days.map((d) => d.v));

  // Какой бар "активен": при hover — индекс под курсором, иначе — hi от бэка
  const activeIdx = hovered !== null ? hovered : days.findIndex((d) => d.hi);

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", height: 150, marginTop: 18 }}>
      {days.map((d, i) => {
        const isActive = i === activeIdx;
        const h = Math.max(10, (d.v / max) * 100);
        return (
          <div
            key={i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              height: "100%",
              justifyContent: "flex-end",
              cursor: "default",
            }}
          >
            <div style={{ position: "relative", width: "100%", flex: 1, display: "flex", alignItems: "flex-end" }}>
              {isActive && (
                <div
                  className="num"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "var(--accent)",
                    color: "var(--accent-ink)",
                    fontWeight: 700,
                    fontSize: "0.8rem",
                    padding: "4px 9px",
                    borderRadius: 999,
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.v}
                </div>
              )}
              <div
                style={{
                  width: "100%",
                  height: isActive ? `calc(${h}% - 30px)` : `${h}%`,
                  minHeight: 10,
                  borderRadius: 11,
                  background: isActive ? "var(--accent)" : "var(--surface-3)",
                  transition: "height .3s cubic-bezier(.2,.8,.2,1), background .15s",
                }}
              />
            </div>
            <span
              style={{
                color: isActive ? "var(--accent)" : "var(--ink-3)",
                fontWeight: isActive ? 700 : 600,
                fontSize: "0.78rem",
                transition: "color .15s",
              }}
            >
              {d.d}
            </span>
          </div>
        );
      })}
    </div>
  );
}
