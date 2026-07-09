// Сохранённая копия исходного дизайн-макета "Панель" (задача #62, Huly-стиль),
// статичные демо-данные (data/fleet.ts). Создана 2026-06-26 при переводе
// Dashboard.tsx на живые данные (карточка #55) - пользователь попросил не
// терять этот вариант, а держать его отдельно ("сохрани текущий статичный
// вариант в отдельный раздел, что бы не забыть что там"). Живая версия
// теперь на / (см. Dashboard.tsx), эта - на /dashboard-demo, есть в NAV
// под отдельной иконкой.
import Icon from "../components/Icon";
import BarChart from "../components/charts/BarChart";
import AreaChart from "../components/charts/AreaChart";
import Donut from "../components/charts/Donut";
import Sparkline from "../components/charts/Sparkline";
import { FLEET } from "../data/fleet";

const fmt = (n: number) => n.toLocaleString("ru-RU");

export default function DashboardDemo() {
  const F = FLEET;
  const t = F.fleetToday;

  return (
    <div className="grid">
      {/* Featured */}
      <section className="fcard a-feat">
        <div className="feat-top">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="badge">
              <Icon name="route" size={15} /> Сегодня
            </span>
            <button className="chip-ic">
              <Icon name="expand" size={16} />
            </button>
          </div>
          <div style={{ marginTop: 24, color: "var(--ink-2)", fontWeight: 700, fontSize: "1.05rem" }}>Машин в парке</div>
          <div className="feat-hero">
            <span className="big">{t.total}</span>
            <span className="unit">ед.</span>
          </div>
          <div className="statline">
            <div className="statrow">
              <span className="sd" style={{ background: "var(--good)" }} />
              <span className="lbl">В рейсе</span>
              <span className="v">{t.route}</span>
            </div>
            <div className="statrow">
              <span className="sd" style={{ background: "var(--ink-3)" }} />
              <span className="lbl">Свободно</span>
              <span className="v">{t.free}</span>
            </div>
            <div className="statrow">
              <span className="sd" style={{ background: "var(--warn)" }} />
              <span className="lbl">На ТО</span>
              <span className="v">{t.service}</span>
            </div>
          </div>
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
            <div
              style={{
                color: "var(--ink-3)",
                fontWeight: 700,
                fontSize: "0.78rem",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                marginBottom: 12,
              }}
            >
              Требует внимания
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12 }}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 11,
                  background: "var(--surface-2)",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--warn-ink)",
                  flex: "0 0 auto",
                }}
              >
                <Icon name="wrench" size={17} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>Mercedes Sprinter</div>
                <div style={{ color: "var(--ink-3)", fontWeight: 600, fontSize: "0.78rem" }}>На обслуживании</div>
              </div>
              <span style={{ color: "var(--warn-ink)", fontWeight: 700, fontSize: "0.8rem" }}>сегодня</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 11,
                  background: "var(--surface-2)",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--bad-ink)",
                  flex: "0 0 auto",
                }}
              >
                <Icon name="gauge" size={17} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "0.92rem" }}>MAN TGX 18.480</div>
                <div style={{ color: "var(--ink-3)", fontWeight: 600, fontSize: "0.78rem" }}>Скоро плановое ТО</div>
              </div>
              <span className="num" style={{ color: "var(--bad-ink)", fontWeight: 700, fontSize: "0.8rem" }}>
                1 200 км
              </span>
            </div>
          </div>
        </div>
        <div className="nested">
          <div className="nested-head">
            <span className="t">Пробег за неделю</span>
            <span className="num" style={{ fontWeight: 600, fontSize: "1.05rem" }}>
              18.4К <span style={{ color: "var(--ink-3)", fontSize: "0.8rem" }}>км</span>
            </span>
          </div>
          <Sparkline values={F.mileageWeek} />
          <button className="cta">
            Все маршруты{" "}
            <span className="arr">
              <Icon name="arrowdr" size={16} />
            </span>
          </button>
        </div>
      </section>

      {/* Activity / рейсы */}
      <section className="fcard a-act">
        <div className="card-head">
          <div>
            <div className="card-title">Рейсы за неделю</div>
          </div>
          <div className="chip-btns">
            <button className="chip-ic">
              <Icon name="filter" size={16} />
            </button>
            <button className="chip-ic">
              <Icon name="arrowdr" size={16} />
            </button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="bignum">
            <span className="n">{F.tripsWeek.total}</span>
            <span className="s">рейсов</span>
          </div>
          <span className="delta up">
            <Icon name="arrowup" size={13} /> {F.tripsWeek.deltaPct}%
          </span>
        </div>
        <BarChart days={F.tripsWeek.days} />
      </section>

      {/* Live vehicle (mint) */}
      <section className="fcard a-stat">
        <div className="card-head">
          <div className="card-title">Сейчас в рейсе</div>
          <button className="chip-ic">
            <Icon name="route" size={16} />
          </button>
        </div>
        <div className="mintcard">
          <div className="row">
            <span className="plate">
              {F.live.plate} <span style={{ opacity: 0.6 }}>{F.live.region}</span>
            </span>
            <Icon name="truck" size={26} />
          </div>
          <div style={{ marginTop: 10 }} className="sub">
            Пройдено сегодня
          </div>
          <div className="km">
            {F.live.kmToday} <span style={{ fontSize: "1.1rem", opacity: 0.7 }}>км</span>
          </div>
        </div>
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--ink-3)", fontWeight: 600, fontSize: "0.84rem" }}>Водитель</span>
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{F.live.driver}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--ink-3)", fontWeight: 600, fontSize: "0.84rem" }}>Маршрут</span>
            <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{F.live.route}</span>
          </div>
        </div>
      </section>

      {/* Fuel area */}
      <section className="fcard a-fuel">
        <div className="card-head">
          <div className="card-title">Расход топлива</div>
          <div className="chip-btns">
            <button className="chip-ic">
              <Icon name="filter" size={16} />
            </button>
            <button className="chip-ic">
              <Icon name="arrowdr" size={16} />
            </button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="bignum">
            <span className="n">₽{fmt(F.fuelWeek.total)}</span>
          </div>
          <span className="delta down">
            <Icon name="arrowdown" size={13} /> {Math.abs(F.fuelWeek.deltaPct)}%
          </span>
          <span style={{ color: "var(--ink-3)", fontWeight: 600, fontSize: "0.82rem" }}>за неделю</span>
        </div>
        <AreaChart values={F.fuelWeek.days} peakIdx={F.fuelWeek.peakIdx} peakLabel={F.fuelWeek.peakLabel} labels={F.fuelWeek.labels} />
      </section>

      {/* Structure donut */}
      <section className="fcard a-struct">
        <div className="card-head">
          <div className="card-title">Структура парка</div>
          <button className="chip-ic">
            <Icon name="expand" size={16} />
          </button>
        </div>
        <Donut segments={F.structure} />
        <div className="foot3">
          {F.footStats.map((s, i) => (
            <div className="f" key={i}>
              <div className="n">{s.n}</div>
              <div className="l">{s.l}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
