"""Baseline — стартовая точка Alembic для Transport CRM (2026-07-01).

Revision ID: 0001
Revises: (начало цепочки)
Create Date: 2026-07-01

Эта миграция — baseline (пустая). Схема БД создаётся и поддерживается через:
  - SQLModel.metadata.create_all()  — создаёт таблицы при первом запуске
  - _PENDING_COLUMNS в database.py  — добавляет колонки, появившиеся после
    первого запуска (исторический механизм для уже живых инсталляций)

Все будущие изменения схемы должны идти через Alembic-миграции:
  alembic revision --autogenerate -m "краткое_описание"

Для уже существующих установок (БД уже есть, alembic_version — нет):
  При первом "alembic upgrade head" Alembic создаст таблицу alembic_version
  и запишет туда "0001" — без каких-либо изменений в схеме.
"""
from typing import Sequence, Union

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Baseline: схема уже существует (либо будет создана через create_all
    # в init_db, которая вызывается после этой миграции в uvicorn lifespan).
    # Эта точка входа просто регистрирует "мы на версии 0001".
    pass


def downgrade() -> None:
    # Откат baseline невозможен — нельзя "удалить" всю схему автоматически.
    # При необходимости пересоздай БД вручную.
    pass
