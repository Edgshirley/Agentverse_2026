# One-shot Keycloak bootstrap (mirrors ../freevo-api/kc/Dockerfile)
FROM python:3.13

WORKDIR /app

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY configure_keycloak.py .

CMD ["python", "configure_keycloak.py"]
