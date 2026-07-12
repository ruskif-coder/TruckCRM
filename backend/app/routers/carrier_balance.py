"""Баланс перевозчиков (2026-07-12, v1.1.3).

Детализация по неделям:
  gross       = Σ trip.amount   (не отменённые рейсы перевозчика за неделю)
  fines       = Σ trip.fines    (штрафы из того же отчёта, колонка «Штраф»)
  net         = (gross - fines) × (1 - carrier.insurance_pct / 100)

Накопительный баланс:
  paid        = Σ CashFlowEntry.income  где counterparty совпадает с именем
                контрагента, привязанного к перевозчику (Carrier.counterparty_id)
  balance     = Σ net_week - paid
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

    # Индекс: carrier_name -> carrier
    carrier_by_name: dict[str, Carrier] = {(c.name or "").strip(): c for c in carriers}

    # Обратный индекс: counterparty_name -> list[carrier_name] (для матчинга платежей)
    cp_name_to_carriers: dict[str, list[str]] = defaultdict(list)
    for c in carriers:
        if c.counterparty_id and c.counterparty_id in counterparties:
            cp_name = (counterparties[c.counterparty_id].name or "").strip()
            if cp_name:
                cp_name_to_carriers[cp_name].append((c.name or "").strip())

    # Рейсы: группируем по (carrier_name, ISO-неделя dep_at)
    # gross и trips  — только не отменённые (выручки нет)
    # fines          — ВСЕ рейсы, включая отменённые: штраф за отмену
    #                  реален и должен уменьшать то, что мы платим перевозчику
    week_buckets: dict = defaultdict(lambda: {"gross": 0.0, "fines": 0.0, "trips": 0})
    for t in trips:
        if not t.dep_at:
            continue
        name = (t.carrier_name or t.source or "").strip()
        if not name:
            continue
        wk = _iso_week_monday(t.dep_at.date())
        key = (name, wk)
        cancelled = (t.status or "").lower().startswith("отмен")
        if not cancelled:
            week_buckets[key]["gross"] += t.amount or 0
            week_buckets[key]["trips"] += 1
        week_buckets[key]["fines"] += t.fines or 0  # штрафы — всегда

    # Агрегируем по неделям
    carrier_net: dict[str, float] = defaultdict(float)
    carrier_gross: dict[str, float] = defaultdict(float)
    carrier_fines: dict[str, float] = defaultdict(float)
    carrier_trips: dict[str, int] = defaultdict(int)
    carrier_weeks: dict[str, list] = defaultdict(list)

    for (name, wk), g in week_buckets.items():
        carrier = carrier_by_name.get(name)
        sk_pct = (carrier.insurance_pct or 0.0) if carrier else 0.0
        gross = g["gross"]
        fines = g["fines"]
        net = (gross - fines) * (1 - sk_pct / 100)
        carrier_net[name] += net
        carrier_gross[name] += gross
        carrier_fines[name] += fines
        carrier_trips[name] += g["trips"]
        carrier_weeks[name].append({
            "week_start": wk.isoformat(),
            "week_end": (wk + timedelta(days=6)).isoformat(),
            "trips": g["trips"],
            "gross": _round2(gross),
            "fines": _round2(fines),
            "net": _round2(net),
        })

    # Поступления: CashFlowEntry.income где counterparty совпадает с контрагентом перевозчика
    carrier_paid: dict[str, float] = defaultdict(float)
    for entry in cashflow:
        if not (entry.income and entry.income > 0):
            continue
        cp_text = (entry.counterparty or "").strip()
        for carrier_name in cp_name_to_carriers.get(cp_text, []):
            carrier_paid[carrier_name] += entry.income

    # Собираем итог — перевозчики с рейсами + перевозчики с поступлениями
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
        weeks = sorted(carrier_weeks.get(name, []), key=lambda w: w["week_start"])
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
