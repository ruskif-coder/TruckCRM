"""Business logic for the dashboard and fleet-status alerts.

Until 2026-06-26 this module also held calc_trip_batch()/batches_overlap_range()/
expense_in_range() - formulas ported 1:1 from the original single-file CRM,
operating on the dormant TripBatch/Expense models. Those were removed when
the dashboard (routers/dashboard.py) was rewired onto the live Trip/
FuelRecord/CashFlowEntry models (task #55) - dashboard.py was their only
caller. The OZON commission/profitability formula itself isn't ported onto
Trip yet (Trip has no commission_pct/driver_pay fields - see task #103); the
old calc_trip_batch() code is preserved in git history if it's needed as a
reference when that lands. maintenance_status()/doc_status() below were
already live-compatible (they take live Truck/MileageLog/Document rows
directly) and are unchanged.
"""

from collections import defaultdict
from datetime import date as date_type, timedelta
from typing import Iterable, Optional

from .models import CashFlowEntry, Carrier, Document, DriverRate, FuelRecord, MileageLog, Settings, Trip, Truck


def num(v):
    return v if v is not None else 0


# Округление денежных/процентных полей до 2 знаков (2026-06-29, по просьбе
# пользователя - "при закрытии выплат водителям встречаю 15-20 знаков после
# запятой"): обычная плавающая ошибка float (net*pct/100 и т.п. дают что-то
# вроде 41743.245000000003) уходила в API без округления - на экране это
# почти всегда незаметно (money()/pct() на фронтенде сами режут до 1-2
# знаков), но «вылезало» в местах, где взяли число напрямую, а не через эти
# хелперы (например, поле суммы в модалке "Провести расчёт" - String(payout)
# без форматирования). round2() режет это в одном месте на backend'е, а не
# в каждом месте на фронтенде по отдельности.
def round2(v):
    return round(v, 2) if v is not None else None


def iso_week_monday(d: date_type) -> date_type:
    """Monday of the ISO calendar week containing `d` - used to bucket Trip/
    FuelRecord rows into weekly trend points. Same rule as
    importers/trip_registry.py::_iso_week_monday (kept as a separate copy
    there since that module's docstring explicitly preserves its formulas
    standalone for the dormant aggregation path)."""
    return d - timedelta(days=d.weekday())


def trip_in_range(trip: Trip, date_from: Optional[date_type], date_to: Optional[date_type]) -> bool:
    """Range check on Trip.dep_at (the only date a trip reliably has)."""
    day = trip.dep_at.date() if trip.dep_at else None
    if day is None:
        return False
    if date_from and day < date_from:
        return False
    if date_to and day > date_to:
        return False
    return True


def cashflow_in_range(entry: CashFlowEntry, date_from: Optional[date_type], date_to: Optional[date_type]) -> bool:
    if date_from and entry.date < date_from:
        return False
    if date_to and entry.date > date_to:
        return False
    return True


def maintenance_status(truck: Truck, mileage_logs: Iterable[MileageLog], settings: Settings) -> dict:
    logs = sorted(
        [m for m in mileage_logs if m.truck_id == truck.id and m.odometer is not None],
        key=lambda m: m.date,
    )
    cur = logs[-1] if logs else None
    service_logs = [m for m in logs if m.is_service]
    last = service_logs[-1] if service_logs else None
    interval = truck.maintenance_interval_km or settings.default_maintenance_interval_km or 15000

    if not cur:
        return {"known": False}

    base_odo = last.odometer if last else None
    since_service = (cur.odometer - base_odo) if base_odo is not None else None
    remaining = (interval - since_service) if since_service is not None else None
    overdue = remaining is not None and remaining <= 0
    soon = remaining is not None and 0 < remaining <= interval * 0.15

    return {
        "known": True,
        "current": cur.odometer,
        "current_date": cur.date,
        "last_service_odo": base_odo,
        "last_service_date": last.date if last else None,
        "since_service": since_service,
        "remaining": remaining,
        "interval": interval,
        "overdue": overdue,
        "soon": soon,
    }


def doc_status(doc: Document, today: Optional[date_type] = None) -> dict:
    today = today or date_type.today()
    if not doc.expiry_date:
        return {"status": "unknown", "days": None}
    d = (doc.expiry_date - today).days
    if d < 0:
        status = "expired"
    elif d <= 30:
        status = "soon"
    else:
        status = "ok"
    return {"status": status, "days": d}


# 2026-06-26 (task #129): weekly P&L breakdown replicating the "TCargo
# 2025.xlsx" / "Сводная OZON" report logic on live Trip data, bucketed by
# ISO calendar week (the user asked for calendar weeks specifically, not the
# spreadsheet's driver-change-split sub-periods - a row there only splits
# when the same truck switches driver mid-week, which calendar-week
# bucketing intentionally doesn't replicate).
#
# Two inputs the Excel formula needs don't exist as real data on the live
# schema yet. Both were resolved by asking the user directly (2026-06-26),
# not guessed:
#   - "% водителя" (driver's revenue share, Excel col G): see
#     DRIVER_PCT_PLACEHOLDER below - originally a flat 30% for everyone,
#     replaced 2026-06-28 by real per-(driver, carrier) DriverRate rows
#     where one exists.
#   - "% ПР" / commission % (Excel col R): Carrier has no commission_pct
#     field. Commission is read from Carrier.insurance_pct ("% СК"),
#     matched by Trip.carrier_name, falling back to
#     Settings.default_commission_pct*100 for any carrier_name that
#     doesn't match a Carrier row.
# "Платная дорога" (toll road, Excel col K): has no field on Trip itself, but
# since 2026-06-28 ("кабинет водителя" план, п.1) is entered manually into
# CashFlowEntry (category="Платная дорога", with truck_id+driver_id+date) on
# the "Расходы" page and read back here via the optional `cash_flow_entries`
# param below - real per-(week, truck, driver) numbers when the caller passes
# the registry rows, 0 if it doesn't (old callers/tests).
#
# 2026-06-28 (роли по API / "Реальный % водителя"): models.DriverRate now
# holds real per-(driver, carrier) pay conditions ("водитель + перевозчик -
# формат - условие", per the user's exact spec), edited from the "Условия
# оплаты" sub-form on the driver card (Drivers.tsx). DRIVER_PCT_PLACEHOLDER
# below is now only a *fallback*, used when:
#   - no DriverRate row exists for this (driver, carrier) at all, or
#   - rate_type is "perKm" (Trip has no distance/km field - see TripBase -
#     so there is no honest per-trip distance to multiply by), or
#   - rate_type is "salary" (a monthly figure has no honest way to be
#     prorated across this row's (week, truck, carrier) slice without
#     inventing a split rule).
# Both fallback cases are flagged in routers/dashboard.py's dynamic notes
# (see `driver_rate_source` on each row below), never silently merged into
# the real-rate rows.
DRIVER_PCT_PLACEHOLDER = 30.0


def commission_pct_for(carrier_name: str, carriers: Iterable[Carrier], settings: Settings) -> float:
    name = (carrier_name or "").strip()
    if name:
        for c in carriers:
            if (c.name or "").strip() == name:
                return c.insurance_pct or 0.0
    return (settings.default_commission_pct or 0) * 100


def carrier_id_for(carrier_name: str, carriers: Iterable[Carrier]) -> Optional[int]:
    """Resolves Trip.carrier_name (free text) to a real Carrier.id, the same
    matching rule commission_pct_for() uses - needed to look up DriverRate
    rows, which key off the real FK rather than the free-text name."""
    name = (carrier_name or "").strip()
    if not name:
        return None
    for c in carriers:
        if (c.name or "").strip() == name:
            return c.id
    return None


def driver_rate_for(
    driver_id: Optional[int],
    carrier_name: str,
    carriers: Iterable[Carrier],
    driver_rates: Iterable[DriverRate],
) -> Optional[DriverRate]:
    """Looks up the real pay-condition row for (driver, carrier), per the
    user's spec "водитель + перевозчик - формат - условие" (2026-06-28).
    Returns None if none exists - callers fall back to
    DRIVER_PCT_PLACEHOLDER rather than fabricating a number."""
    if driver_id is None:
        return None
    cid = carrier_id_for(carrier_name, carriers)
    if cid is None:
        return None
    for r in driver_rates:
        if r.driver_id == driver_id and r.carrier_id == cid:
            return r
    return None


def weekly_pnl(
    trips: Iterable[Trip],
    fuel_records: Iterable[FuelRecord],
    carriers: Iterable[Carrier],
    settings: Settings,
    date_from: Optional[date_type],
    date_to: Optional[date_type],
    driver_rates: Iterable[DriverRate] = (),
    cash_flow_entries: Iterable[CashFlowEntry] = (),
) -> list:
    """One row per (ISO week, truck, driver, carrier) combination found in
    `trips`, with the same columns as the Excel sheet: gross, commission,
    net-of-commission, fines, fuel, driver payout, profit, profitability.
    See the module comment above for the driver-%/commission-% assumptions.
    `driver_rates` is optional (defaults to none) so existing callers/tests
    that don't care about real rates keep working unchanged, falling back to
    DRIVER_PCT_PLACEHOLDER for every row. `cash_flow_entries` is likewise
    optional - when omitted, toll stays 0 (old behaviour); pass the registry
    rows to get real "Платная дорога" numbers (2026-06-28, "кабинет
    водителя" план, п.1). Same registry also feeds `driver_paid` per row -
    the sum of "Расчёт с водителем" entries for that (week, truck, driver),
    used by Reports.tsx to badge how much of `driver_payout` has actually
    been paid out (план, п.3 доработка)."""
    # Расширяем диапазон до полных ISO-недель (пн–вс) перед любой фильтрацией.
    # Без этого date_from, попадающий в середину недели (например, воскресенье
    # 31 мая), обрезал рейсы с 28–30 мая, а строка отчёта всё равно печатала
    # заголовок "25–31 мая" — пользователь видел 3 рейса вместо 12.
    if date_from:
        date_from = date_from - timedelta(days=date_from.weekday())
    if date_to:
        date_to = date_to + timedelta(days=6 - date_to.weekday())

    # Исключаем отменённые рейсы (регистронезависимо): "отмена", "Отменено",
    # "Отменена" и т.п. — пользователь может вводить вручную, имортёр OZON
    # использует "Отменено". Все остальные статусы ("Завершено", "Получен ответ",
    # "" и др.) идут в расчёт.
    in_range = [
        t for t in trips
        if trip_in_range(t, date_from, date_to)
        and not (t.status or "").lower().startswith("отмен")
    ]

    # Топливо из реестра расходов (CashFlowEntry, category="Топливо") — единый
    # источник правды вместе со страницей «Расходы». До 2026-07-05 использовался
    # FuelRecord напрямую, что давало расхождение: FuelRecord хранит только
    # E100-импорт, CashFlowEntry учитывает также наличные и все вручную внесённые
    # позиции. Параметр `fuel_records` сохранён в сигнатуре для обратной
    # совместимости существующих вызывающих мест, но больше не используется здесь.
    # Как и раньше: топливо известно только по машине, а не по водителю — если
    # одна машина работала с несколькими водителями в ту же неделю, расход
    # распределяется по количеству рейсов (честный прокси, отмечается в notes).
    fuel_by_truck_week: dict = defaultdict(float)
    for c in cash_flow_entries:
        if c.category != "Топливо" or not c.date:
            continue
        if date_from and c.date < date_from:
            continue
        if date_to and c.date > date_to:
            continue
        wk = iso_week_monday(c.date)
        fuel_by_truck_week[(wk, c.truck_id)] += c.expense or 0

    # Платная дорога (CashFlowEntry, category="Платная дорога") - в отличие
    # от топлива, в реестре расходов сразу заполняются и truck_id, и
    # driver_id на каждой строке (это требование UI на странице "Расходы"),
    # поэтому прямой lookup по (неделя, машина, водитель) без пропорционального
    # распределения по рейсам, как у топлива.
    toll_by_truck_driver_week: dict = defaultdict(float)
    for c in cash_flow_entries:
        if c.category != "Платная дорога" or not c.date:
            continue
        if date_from and c.date < date_from:
            continue
        if date_to and c.date > date_to:
            continue
        wk = iso_week_monday(c.date)
        toll_by_truck_driver_week[(wk, c.truck_id, c.driver_id)] += c.expense or 0

    # «Провести расчёт» (2026-06-28, план "кабинет водителя", п.3) - то же
    # самое, но категория "Расчёт с водителем": сумма проводок, нажатых
    # кнопкой на странице "Отчёты" для конкретной строки. Дата проводки -
    # не "сегодня", а понедельник недели отчёта (Reports.tsx,
    # handleSettleSave) - специально, чтобы iso_week_monday(c.date) ниже
    # клал её в правильный бакет недели независимо от того, когда кнопку
    # нажали на самом деле. Используется только для индикатора оплаты в
    # Reports.tsx ("сколько уже проведено" против расчётной driver_payout),
    # саму driver_payout это число не меняет.
    #
    # Без фильтра по date_from/date_to (2026-06-29, фикс): раз дата здесь -
    # синтетический "якорь недели", а не настоящая дата события, сравнивать
    # её с границами выбранного периода нельзя - если date_from приходится
    # не на понедельник (период короче полной недели или просто сдвинут),
    # эта запись (дата = понедельник, который раньше date_from) отсекалась
    # фильтром, и зелёная отметка об оплате пропадала на самой ранней неделе
    # отчёта, хотя расчёт был проведён. Ниже значение всё равно читается
    # только для (неделя, машина, водитель), которые реально попали в
    # `groups` - то есть неделя уже прошла через trip_in_range, лишний
    # фильтр здесь был избыточен и только ломал граничные недели.
    paid_by_truck_driver_week: dict = defaultdict(float)
    for c in cash_flow_entries:
        if c.category != "Расчёт с водителем" or not c.date:
            continue
        wk = iso_week_monday(c.date)
        paid_by_truck_driver_week[(wk, c.truck_id, c.driver_id)] += c.expense or 0

    groups: dict = defaultdict(lambda: {"trips": 0, "gross": 0.0, "fines": 0.0, "days": set()})
    trip_count_by_truck_week: dict = defaultdict(int)
    for t in in_range:
        wk = iso_week_monday(t.dep_at.date())
        key = (wk, t.truck_id, t.driver_id, t.carrier_name or t.source or "—")
        g = groups[key]
        g["trips"] += 1
        g["gross"] += t.amount or 0
        g["fines"] += t.fines or 0
        g["days"].add(t.dep_at.date())
        trip_count_by_truck_week[(wk, t.truck_id)] += 1

    rows = []
    for (wk, truck_id, driver_id, carrier_name), g in groups.items():
        gross = g["gross"]
        fines = g["fines"]
        commission_pct = commission_pct_for(carrier_name, carriers, settings)
        commission_rub = gross * commission_pct / 100
        net = gross - commission_rub

        rate = driver_rate_for(driver_id, carrier_name, carriers, driver_rates)
        if rate is None:
            driver_pct = DRIVER_PCT_PLACEHOLDER
            driver_payout = net * driver_pct / 100
            driver_rate_source = "placeholder"
        elif rate.rate_type == "percentOfNet":
            driver_pct = rate.rate_value
            driver_payout = net * driver_pct / 100
            driver_rate_source = "percentOfNet"
        elif rate.rate_type == "perTrip":
            driver_payout = rate.rate_value * g["trips"]
            # "% водит." в таблице - производное число для отображения
            # (сколько выплата составляет от Netto), не отдельный введённый
            # параметр - формат perTrip задаёт сумму за рейс, не процент.
            driver_pct = (driver_payout / net * 100) if net else 0.0
            driver_rate_source = "perTrip"
        else:
            # perKm/salary: см. комментарий у DRIVER_PCT_PLACEHOLDER выше -
            # нет честных данных, чтобы посчитать настоящую сумму на этот
            # срез (неделя×машина×перевозчик), поэтому используется тот же
            # помеченный плейсхолдер, что и при отсутствии условия вовсе.
            driver_pct = DRIVER_PCT_PLACEHOLDER
            driver_payout = net * driver_pct / 100
            driver_rate_source = "perKm_fallback" if rate.rate_type == "perKm" else "salary_fallback"

        truck_week_trips = trip_count_by_truck_week[(wk, truck_id)] or 1
        truck_week_fuel = fuel_by_truck_week.get((wk, truck_id), 0.0)
        fuel = truck_week_fuel * (g["trips"] / truck_week_trips)
        toll = toll_by_truck_driver_week.get((wk, truck_id, driver_id), 0.0)
        driver_paid = paid_by_truck_driver_week.get((wk, truck_id, driver_id), 0.0)
        profit = net - fines - toll - fuel - driver_payout
        profitability = (profit / net) if net else None
        price_per_trip = (gross / g["trips"]) if g["trips"] else 0.0
        work_days = len(g["days"])
        price_per_day = round2(driver_payout / work_days) if work_days else 0.0
        fine_pct = ((fines + toll) / gross) if gross else None

        rows.append(
            {
                "week_start": wk,
                "week_end": wk + timedelta(days=6),
                "truck_id": truck_id,
                "driver_id": driver_id,
                "carrier_name": carrier_name,
                "trips": g["trips"],
                "gross": round2(gross),
                "commission_pct": round2(commission_pct),
                "commission_rub": round2(commission_rub),
                "net": round2(net),
                "fines": round2(fines),
                "toll": round2(toll),
                "fuel": round2(fuel),
                "driver_pct": round2(driver_pct),
                "driver_payout": round2(driver_payout),
                "driver_paid": round2(driver_paid),
                "driver_rate_source": driver_rate_source,
                "profit": round2(profit),
                "profitability": profitability,
                "price_per_trip": round2(price_per_trip),
                "work_days": work_days,
                "price_per_day": price_per_day,
                "fine_pct": fine_pct,
            }
        )

    rows.sort(key=lambda r: (r["week_start"], -r["gross"]))
    return rows
