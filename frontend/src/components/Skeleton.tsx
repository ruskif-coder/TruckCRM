// Skeleton-плейсхолдер для таблиц и списков при загрузке данных (2026-07-05).
// Заменяет <p>Загрузка...</p> анимированными строками shimmer.

export default function SkeletonRows({
  rows = 8,
  gap = 6,
}: {
  rows?: number;
  gap?: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap, padding: "4px 0" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="skeleton-row"
          style={{
            // Затухание к концу списка — воспринимается натуральнее
            opacity: Math.max(0.25, 1 - i * 0.1),
            // Переменная ширина делает скелетон живым, не одинаковым
            width: i % 3 === 2 ? "72%" : i % 3 === 1 ? "88%" : "100%",
          }}
        />
      ))}
    </div>
  );
}
