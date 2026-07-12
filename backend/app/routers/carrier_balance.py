"""Баланс перевозчиков (2026-07-12, v1.1.3).

Формула на неделю:
  gross_week  = Σ trip.amount  (не отменённые рейсы перевозчика за неделю)
  fines_week  = Σ CashFlowEntry.expense  где category="Штрафы" и counterparty
                совпадает с контрагентом перевозчика, а entry.date попадает
                в ту же ISO-неделю (пн–вс).
  net_week    = (gross_week - fines_week) × (1 - carrier.insurance_pct / 100)

Накопительный баланс:
  paid    = Σ CashFlowEntry.income  где counterparty совпадает с контрагентом
  balance = Σ net_week - paid

Paid и fines матчатся по: Carrier.counterparty_id → Counterparty.name →
CashFlowEntry.counterparty (текстовое поле).
"""

from collections import defaultdict
from datetime import date as date_type, timedelta

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..auth import get_current_user
from ..database import get_session
from ..models import Carrier, CashFlowEntry, Counterparty, Trip

router = APIRouter(prefix="/api/carriers/balance", tags=["carrier-balance"])
_auth = [Depends(get_current_user)]


def _iso_week_monday(d: date_type) -> date_type:
    return d - timedelta(days=d.weekday())


def _round2(v: float) -> float:
    return round(v, 2)


@router.get("/", dependencies=_auth)
def carrier_balance_summary(session: Session = Depends(get_session)):
    """Сводка баланса по всем перевозчикам (за всё время, накопительно)."""
    carriers = session.exec(select(Carrier)).all()
    counterparties = {c.id: c for c in session.exec(select(Counterparty)).all()}
    trips = session.exec(select(Trip)).all()
    cashflow = session.exec(select(CashFlowEntry)).all()

    # Индекс: carrier_name -> carrier (для быстрого поиска)
    carrier_by_name: dict[str, Carrier] = {(c.name or "").strip(): c for c in carriers}

    # Обратный индекс: counterparty_name -> list[carrier_name]
    cp_name_to_carriers: dict[str, list[str]] = defaultdict(list)
    for c in carriers:
        if c.counterparty_id and c.counterparty_id in counterparties:
            cp_name = counterparties[c.counterparty_id].name or ""
            if cp_name:
                cp_name_to_carriers[cp_name.strip()].append((c.name or "").strip())

    # Штрафы из реестра расходов: category="Штрафы", counterparty совпадает
    # с контрагентом перевозчика. Группируем по (carrier_name, ISO-неделя entry.date).
    # dict: (carrier_name, wk) -> fines_sum
    fine_buckets: dict = defaultdict(float)
    # Поступления: суммарно по перевозчику (не разбиваем по неделям — привязка
    # платежей к конкретной неделе не определена договором).
    carrier_paid: dict[str, float] = defaultdict(float)

    for entry in cashflow:
        cp_text = (entry.counterparty or "").strip()
        if cp_text not in cp_name_to_carriers:
            continue
        if entry.income and entry.income > 0:
            for carrier_name in cp_name_to_carriers[cp_text]:
                carrier_paid[carrier_name] += entry.income
        if entry.expense and entry.expense > 0 and (entry.category or "").strip() == "Штрафы":
            wk = _iso_week_monday(entry.date)
            for carrier_name in cp_name_to_carriers[cp_text]:
                fine_buckets[(carrier_name, wk)] += entry.expense

    # Рейсы: группируем по (carrier_name, ISO-неделя dep_at). Исключаем отменённые.
    week_buckets: dict = defaultdict(lambda: {"gross": 0.0, "trips": 0})
    for t in trips:
        if not t.dep_at:
            continue
        if (t.status or "").lower().startswith("отмен"):
            continue
        name = (t.carrier_name or t.source or "").strip()
        if not name:
            continue
        wk = _iso_week_monday(t.dep_at.date())
        week_buckets[(name, wk)]["gross"] += t.amount or 0
        week_buckets[(name, wk)]["trips"] += 1

    # Объединяем все недели: из рейсов + из штрафов (штраф может быть в неделю без рейсов)
    all_keys: set = set(week_buckets.keys()) | set(fine_buckets.keys())

    carrier_net: dict[str, float] = defaultdict(float)
    carrier_gross: dict[str, float] = defaultdict(float)
    carrier_fines: dict[str, float] = defaultdict(float)
    carrier_trips: dict[str, int] = defaultdict(int)
    # dict: carrier_name -> {wk -> week_dict}  (используем dict для merge)
    carrier_weeks_map: dict[str, dict] = defaultdict(dict)

    for (name, wk) in all_keys:
        carrier = carrier_by_name.get(name)
        sk_pct = (carrier.insurance_pct or 0.0) if carrier else 0.0
        gross = week_buckets[(name, wk)]["gross"] if (name, wk) in week_buckets else 0.0
        trips_cnt = week_buckets[(name, wk)]["trips"] if (name, wk) in week_buckets else 0
        fines = fine_buckets.get((name, wk), 0.0)
        net = (gross - fines) * (1 - sk_pct / 100)

        carrier_net[name] += net
        carrier_gross[name] += gross
        carrier_fines[name] += fines
        carrier_trips[name] += trips_cnt
        carrier_weeks_map[name][wk] = {
            "week_start": wk.isoformat(),
            "week_end": (wk + timedelta(days=6)).isoformat(),
            "trips": trips_cnt,
            "gross": _round2(gross),
            "fines": _round2(fines),
            "net": _round2(net),
        }

    # Собираем итоговый список
    processed_names: set = set(carrier_gross.keys()) | set(carrier_paid.keys())

    result = []
    for name in sorted(processed_names):
        carrier = carrier_by_name.get(name)
        cp_id = carrier.counterparty_id if carrier else None
        cp = counterparties.get(cp_id) if cp_id else None
        gross = carrier_gross.get(name, 0.0)
        fines = carrier_fines.get(name, 0.0)
        net = carrier_net.get(name, 0.0)
        paid = carrier_paid.get(name, 0.0)
        balance = net - paid
        weeks = sorted(carrier_weeks_map.get(name, {}).values(), key=lambda w: w["week_start"])
        result.append({
            "carrier_name": name,
            "carrier_id": carrier.id if carrier else None,
            "counterparty_id": cp_id,
            "counterparty_name": cp.name if cp else None,
            "trips": carrier_trips.get(name, 0),
            "gross": _round2(gross),
            "fines": _round2(fines),
            "net": _round2(net),
            "paid": _round2(paid),
            "balance": _round2(balance),
            "weeks": weeks,
        })

    result.sort(key=lambda r: -r["balance"])
    return result
