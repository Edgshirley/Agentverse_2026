# Friend Spreader API (FastAPI) — mirrors ../freevo-api/app/Dockerfile
FROM python:3.13

WORKDIR /usr/src/app

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .

ENV PYTHONPATH=/usr/src/app

CMD exec uvicorn src.main:api --host 0.0.0.0 --port ${PORT:-8000} --reload
