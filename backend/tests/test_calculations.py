"""Уровень 2 — unit-тесты для calculations.py.

Тестируем weekly_pnl() на чистых Python-объектах (SimpleNamespace),
без БД — быстро и изолированно.
"""

from datetime import date, datetime
from types import SimpleNamespace

import pytest

from app.calculations import DRIVER_PCT_PLACEHOLDER, weekly_pnl

# ---------------------------------------------------------------------------
# Фабрики тестовых объектов (SimpleNamespace имитирует SQLModel-строки)
# ---------------------------------------------------------------------------

WEEK_MON = date(2025, 6, 2)  # Понедельник


def _trip(**kw) -> SimpleNamespace:
    defaults = dict(
        truck_id=1,
        driver_id=10,
        dep_at=datetime(2025, 6, 2, 8, 0),  # попадает в WEEK_MON
        amount=100_000.0,
        fines=0.0,
        carrier_name="TestCarrier",
        source="",
        status="",
    )
    defaults.update(kw)
    return SimpleNamespace(**defaults)


def _carrier(name="TestCarrier", insurance_pct=10.0, id=1) -> SimpleNamespace:
    return SimpleNamespace(name=name, insurance_pct=insurance_pct, id=id)


def _settings(default_commission_pct=0.0) -> SimpleNamespace:
    return SimpleNamespace(
        default_commission_pct=default_commission_pct,
        default_maintenance_interval_km=15_000,
    )


def _rate(
    driver_id=10,
    carrier_id=1,
    rate_type="percentOfNet",
    rate_value=30.0,
) -> SimpleNamespace:
    return SimpleNamespace(
        driver_id=driver_id,
        carrier_id=carrier_id,
        rate_type=rate_type,
        rate_value=rate_value,
    )


def _cashflow(category: str, date_: date, truck_id=1, driver_id=10, expense=0.0) -> SimpleNamespace:
    return SimpleNamespace(
        category=category,
        date=date_,
        truck_id=truck_id,
        driver_id=driver_id,
        expense=expense,
    )


CARRIERS = [_carrier()]
SETTINGS = _settings()


# ---------------------------------------------------------------------------
# Тесты
# ---------------------------------------------------------------------------

class TestWeeklyPnlEmpty:
    def test_no_trips_returns_empty_list(self):
        result = weekly_pnl([], [], CARRIERS, SETTINGS, None, None)
        assert result == []

    def test_only_cancelled_trips_returns_empty(self):
        trips = [
            _trip(status="Отменено"),
            _trip(status="отмена"),
            _trip(status="ОТМЕНЕНА"),
        ]
        result = weekly_pnl(trips, [], CARRIERS, SETTINGS, None, None)
        assert result == []


class TestWeeklyPnlPercentOfNet:
    def test_commission_and_net_calculated_correctly(self):
        trips = [_trip(amount=100_000.0)]
        rates = [_rate(rate_type="percentOfNet", rate_value=30.0)]

        result = weekly_pnl(trips, [], CARRIERS, SETTINGS, None, None, driver_rates=rates)

        assert len(result) == 1
        row = result[0]
        assert row["gross"] == 100_000.0
        # insurance_pct=10% → commission_rub = 10 000
        assert row["commission_pct"] == 10.0
        assert row["commission_rub"] == 10_000.0
        assert row["net"] == 90_000.0
        # driver 30% of net = 27 000
        assert row["driver_payout"] == 27_000.0
        assert row["driver_pct"] == 30.0
        assert row["driver_rate_source"] == "percentOfNet"

    def test_profit_equals_net_minus_costs(self):
        trips = [_trip(amount=100_000.0)]
        rates = [_rate(rate_type="percentOfNet", rate_value=30.0)]

        result = weekly_pnl(trips, [], CARRIERS, SETTINGS, None, None, driver_rates=rates)

        row = result[0]
        expected_profit = row["net"] - row["fines"] - row["toll"] - row["fuel"] - row["driver_payout"]
        assert abs(row["profit"] - expected_profit) < 0.01

    def test_week_start_end_correct(self):
        trips = [_trip(dep_at=datetime(2025, 6, 4, 10, 0))]  # среда

        result = weekly_pnl(trips, [], CARRIERS, SETTINGS, None, None)

        row = result[0]
        assert row["week_start"] == date(2025, 6, 2)   # понедельник
        assert row["week_end"] == date(2025, 6, 8)     # воскресенье


class TestWeeklyPnlPerTrip:
    def test_per_trip_payout_multiplied_by_count(self):
        trips = [_trip(amount=100_000.0), _trip(amount=80_000.0)]
        rates = [_rate(rate_type="perTrip", rate_value=5_000.0)]

        result = weekly_pnl(trips, [], CARRIERS, SETTINGS, None, None, driver_rates=rates)

        assert len(result) == 1
        row = result[0]
        assert row["trips"] == 2
        assert row["driver_payout"] == 10_000.0  # 2 × 5 000
        assert row["driver_rate_source"] == "perTrip"

    def test_per_trip_driver_pct_is_derived(self):
        """perTrip задаёт сумму, а не %, pct = производное для отображения."""
        trips = [_trip(amount=100_000.0)]
        rates = [_rate(rate_type="perTrip", rate_value=5_000.0)]

        result = weekly_pnl(trips, [], CARRIERS, SETTINGS, None, None, driver_rates=rates)

        row = result[0]
        net = row["net"]
        expected_pct = round(5_000.0 / net * 100, 2) if net else 0.0
        assert abs(row["driver_pct"] - expected_pct) < 0.01


class TestWeeklyPnlFallback:
    def test_placeholder_used_without_rate(self):
        trips = [_trip(amount=100_000.0)]
        result = weekly_pnl(trips, [], CARRIERS, SETTINGS, None, None, driver_rates=[])

        row = result[0]
        assert row["driver_rate_source"] == "placeholder"
        assert row["driver_pct"] == DRIVER_PCT_PLACEHOLDER

    def test_placeholder_used_for_perKm(self):
        trips = [_trip(amount=100_000.0)]
        rates = [_rate(rate_type="perKm", rate_value=50.0)]

        result = weekly_pnl(trips, [], CARRIERS, SETTINGS, None, None, driver_rates=rates)

        row = result[0]
        assert row["driver_rate_source"] == "perKm_fallback"
        assert row["driver_pct"] == DRIVER_PCT_PLACEHOLDER


class TestWeeklyPnlFuel:
    def test_fuel_from_cashflow_entry(self):
        trips = [_trip(amount=100_000.0)]
        fuel = _cashflow("Топливо", WEEK_MON, truck_id=1, expense=15_000.0)

        result = weekly_pnl(trips, [], CARRIERS, SETTINGS, None, None, cash_flow_entries=[fuel])

        assert result[0]["fuel"] == 15_000.0

    def test_fuel_split_proportionally_across_drivers(self):
        """Два водителя на одной машине — топливо делится по числу рейсов."""
        trip1 = _trip(truck_id=1, driver_id=10, amount=50_000.0)
        trip2 = _trip(truck_id=1, driver_id=20, amount=50_000.0)
        fuel = _cashflow("Топливо", WEEK_MON, truck_id=1, expense=10_000.0)

        result = weekly_pnl(
            [trip1, trip2], [], CARRIERS, SETTINGS, None, None, cash_flow_entries=[fuel]
        )

        # Два ряда — по одному на каждого водителя, топливо 50/50
        assert len(result) == 2
        for row in result:
            assert row["fuel"] == 5_000.0

    def test_non_fuel_category_not_counted_as_fuel(self):
        trips = [_trip(amount=100_000.0)]
        entry = _cashflow("Прочее", WEEK_MON, truck_id=1, expense=5_000.0)

        result = weekly_pnl(trips, [], CARRIERS, SETTINGS, None, None, cash_flow_entries=[entry])

        assert result[0]["fuel"] == 0.0


class TestWeeklyPnlToll:
    def test_toll_reduces_profit(self):
        trips = [_trip(amount=100_000.0)]
        toll = _cashflow("Платная дорога", WEEK_MON, truck_id=1, driver_id=10, expense=3_000.0)

        result = weekly_pnl(trips, [], CARRIERS, SETTINGS, None, None, cash_flow_entries=[toll])

        row = result[0]
        assert row["toll"] == 3_000.0
        # profit = net - fines - toll - fuel - driver_payout
        expected_profit = row["net"] - row["fines"] - 3_000.0 - row["fuel"] - row["driver_payout"]
        assert abs(row["profit"] - expected_profit) < 0.01

    def test_toll_scoped_to_truck_and_driver(self):
        """Платная дорога водителя 10 не попадает в строку водителя 20."""
        trip1 = _trip(truck_id=1, driver_id=10)
        trip2 = _trip(truck_id=1, driver_id=20, dep_at=datetime(2025, 6, 3, 8, 0))
        toll = _cashflow("Платная дорога", WEEK_MON, truck_id=1, driver_id=10, expense=2_000.0)

        result = weekly_pnl(
            [trip1, trip2], [], CARRIERS, SETTINGS, None, None, cash_flow_entries=[toll]
        )

        rows_by_driver = {r["driver_id"]: r for r in result}
        assert rows_by_driver[10]["toll"] == 2_000.0
        assert rows_by_driver[20]["toll"] == 0.0


class TestWeeklyPnlCancelledTrips:
    def test_active_trip_included(self):
        trips = [
            _trip(amount=100_000.0, status=""),
            _trip(amount=80_000.0, status="Отменено"),
        ]
        result = weekly_pnl(trips, [], CARRIERS, SETTINGS, None, None)

        assert len(result) == 1
        assert result[0]["gross"] == 100_000.0

    def test_case_insensitive_cancel_detection(self):
        trips = [
            _trip(amount=100_000.0, status="ОТМЕНЕНА"),
            _trip(amount=50_000.0, status="Отменено"),
            _trip(amount=30_000.0, status="отмена"),
        ]
        result = weekly_pnl(trips, [], CARRIERS, SETTINGS, None, None)
        assert result == []


class TestWeeklyPnlDateRange:
    def test_trips_outside_range_excluded(self):
        # weekly_pnl расширяет date_to до конца ISO-недели.
        # 2025-06-22 — воскресенье (weekday=6), расширения нет → date_to остаётся 22 июня.
        # trip_out = 14 июля → в неделе 14-20 июля → за границей диапазона.
        trip_in = _trip(dep_at=datetime(2025, 6, 4, 8, 0), amount=100_000.0)    # среда, нед. 2-8 июня
        trip_out = _trip(dep_at=datetime(2025, 7, 14, 8, 0), amount=50_000.0)   # понедельник, нед. 14-20 июля

        result = weekly_pnl(
            [trip_in, trip_out], [], CARRIERS, SETTINGS,
            date_from=date(2025, 6, 1), date_to=date(2025, 6, 22),
        )

        # Должна быть только одна строка (с trip_in)
        assert len(result) == 1
        assert result[0]["gross"] == 100_000.0
