FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# При старте контейнера:
#   1. alembic upgrade head — применяет все ожидающие миграции схемы.
#      На уже существующей БД — создаёт таблицу alembic_version и проставляет
#      текущую версию (baseline 0001). На новой БД — то же самое плюс пустая
#      baseline миграция; все реальные таблицы создаст init_db() ниже.
#   2. uvicorn — запускает FastAPI; lifespan → init_db() доделывает create_all
#      и legacy _PENDING_COLUMNS (идемпотентны, если Alembic уже всё сделал).
CMD ["sh", "-c", "/usr/local/bin/alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
