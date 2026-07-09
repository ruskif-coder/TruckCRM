#!/usr/bin/env python3
"""Утилита для ручного сброса пароля (и логина) администратора.

Использование (запускать из папки backend/):
    python reset_admin.py --password НовыйПароль
    python reset_admin.py --username admin --password НовыйПароль

Скрипт напрямую меняет запись в БД — не требует запущенного сервера.
Безопасен: не трогает данные других пользователей.

В Docker-контейнере:
    docker compose exec backend python reset_admin.py --password НовыйПароль
"""

import argparse
import os
import sys

# Позволяем запускать как из backend/ так и из PROD/
sys.path.insert(0, os.path.dirname(__file__))

from app.auth import hash_password
from app.database import engine, init_db
from app import models
from sqlmodel import Session, select


def main():
    parser = argparse.ArgumentParser(description="Сброс пароля администратора Transport CRM")
    parser.add_argument("--username", default=None, help="Новый логин (необязательно, по умолчанию не меняется)")
    parser.add_argument("--password", required=True, help="Новый пароль")
    args = parser.parse_args()

    if len(args.password) < 6:
        print("❌  Пароль должен содержать не менее 6 символов.", file=sys.stderr)
        sys.exit(1)

    init_db()  # гарантируем, что таблицы существуют

    with Session(engine) as session:
        admin = session.exec(
            select(models.User).where(models.User.role == "admin")
        ).first()

        if not admin:
            print("❌  Администратор не найден в базе данных.", file=sys.stderr)
            sys.exit(1)

        old_username = admin.username
        admin.password_hash = hash_password(args.password)
        if args.username and args.username != old_username:
            admin.username = args.username
            print(f"✅  Логин изменён: {old_username!r} → {args.username!r}")
        else:
            print(f"✅  Логин оставлен: {old_username!r}")

        session.add(admin)
        session.commit()
        print("✅  Пароль успешно обновлён.")
        print(f"\nВход: логин={admin.username!r}, новый пароль задан.")


if __name__ == "__main__":
    main()
