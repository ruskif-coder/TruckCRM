"""Shared helpers across importers (trip_registry.py, fuel_registry.py):
plate normalization and find-or-create lookups against the Truck/Driver
tables, plus small cell-parsing utilities. Pulled out of trip_registry.py
on 2026-06-19 evening when the Fuel import needed the exact same
plate-matching logic, so the two importers don't drift out of sync.
"""

from datetime import date, datetime
from typing import Optional

from sqlmodel import Session, select

from .. import models

# Russian plates only use the 12 Cyrillic letters that have a Latin
# lookalike - some exports write them in Latin.
PLATE_LATIN_TO_CYRILLIC = {
    "A": "А", "B": "В", "E": "Е", "K": "К", "M": "М", "H": "Н",
    "O": "О", "P": "Р", "C": "С", "T": "Т", "Y": "У", "X": "Х",
}


def normalize_plate(raw: str) -> str:
    s = (raw or "").strip().upper().replace(" ", "").replace("-", "")
    return "".join(PLATE_LATIN_TO_CYRILLIC.get(ch, ch) for ch in s)


def fio_to_display_name(fio: str) -> str:
    """'АЛЕКСАНДРОВИЧ МИХАИЛ ЦЕПКОВ' -> 'Цепков Михаил' (app's Фамилия Имя order)."""
    tokens = (fio or "").strip().split()
    if len(tokens) >= 3:
        surname, first_name = tokens[-1], tokens[1]
        return f"{surname.capitalize()} {first_name.capitalize()}"
    return (fio or "").strip().title()


def _surname_token(fio: str) -> str:
    tokens = (fio or "").strip().split()
    return tokens[-1].lower() if tokens else ""


def find_or_create_driver(session: Session, fio: str) -> tuple[models.Driver, bool]:
    surname = _surname_token(fio)
    drivers = session.exec(select(models.Driver)).all()
    for d in drivers:
        name_tokens = [t.lower() for t in d.name.strip().split()]
        if name_tokens and surname in (name_tokens[0], name_tokens[-1]):
            return d, False
    driver = models.Driver(name=fio_to_display_name(fio))
    session.add(driver)
    session.commit()
    session.refresh(driver)
    return driver, True


def find_or_create_truck(session: Session, raw_plate: str) -> tuple[models.Truck, bool]:
    norm = normalize_plate(raw_plate)
    trucks = session.exec(select(models.Truck)).all()
    for t in trucks:
        if normalize_plate(t.plate) == norm:
            return t, False
    truck = models.Truck(label=norm, plate=norm)
    session.add(truck)
    session.commit()
    session.refresh(truck)
    return truck, True


def _cell_str(raw) -> str:
    if raw is None:
        return ""
    return str(raw).strip()


def _parse_dt(raw, fmt: str = "%d.%m.%Y %H:%M:%S") -> Optional[datetime]:
    """Full datetime parse (keeps time, unlike a date-only parse). `fmt` lets
    each importer pass its own export's exact layout (Trips: no comma;
    Fuel: comma after the date - see fuel_registry.py)."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return raw
    if isinstance(raw, date):
        return datetime(raw.year, raw.month, raw.day)
    return datetime.strptime(str(raw).strip(), fmt)
