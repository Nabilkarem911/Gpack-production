"""
G.PACK AI Forecasting Service
Simple demand forecasting using rolling average + trend
"""

import os
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import psycopg2
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="G.PACK AI Forecasting")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'postgres'),
    'port': os.getenv('DB_PORT', '5432'),
    'dbname': os.getenv('DB_NAME', 'gpack_db'),
    'user': os.getenv('DB_USER', 'gpack_user'),
    'password': os.getenv('DB_PASSWORD', 'gpack_pass'),
}


def get_db_connection():
    return psycopg2.connect(**DB_CONFIG)


@app.get("/health")
def health():
    return {"status": "ok", "service": "gpack-ai"}


@app.post("/forecast/client/{client_id}")
def forecast_client(client_id: str, periods: int = 30):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT o.order_date::date, SUM(oi.quantity)::float as qty
                FROM orders o
                JOIN order_items oi ON oi.order_id = o.id
                WHERE o.client_id = %s
                  AND o.status NOT IN ('cancelled', 'draft')
                GROUP BY o.order_date::date
                ORDER BY o.order_date::date
                """,
                (client_id,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    if not rows or len(rows) < 3:
        return {
            "client_id": client_id,
            "periods": periods,
            "forecast": [],
            "message": "مفيش بيانات كافية للتوقع (محتاج 3 طلبات على الأقل)",
            "total_orders": len(rows),
            "ready": False,
        }

    dates = [r[0] for r in rows]
    quantities = [float(r[1]) for r in rows]
    forecast = _calculate_forecast(dates, quantities, periods)

    return {
        "client_id": client_id,
        "periods": periods,
        "forecast": forecast,
        "total_orders": len(rows),
        "date_range": {"from": str(dates[0]), "to": str(dates[-1])},
        "ready": True,
    }


@app.post("/forecast/variant/{variant_id}")
def forecast_variant(variant_id: str, periods: int = 30):
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT o.order_date::date, SUM(oi.quantity)::float as qty
                FROM orders o
                JOIN order_items oi ON oi.order_id = o.id
                WHERE oi.variant_id = %s
                  AND o.status NOT IN ('cancelled', 'draft')
                GROUP BY o.order_date::date
                ORDER BY o.order_date::date
                """,
                (variant_id,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    if not rows or len(rows) < 3:
        return {
            "variant_id": variant_id,
            "periods": periods,
            "forecast": [],
            "message": "مفيش بيانات كافية للتوقع (محتاج 3 طلبات على الأقل)",
            "total_orders": len(rows),
            "ready": False,
        }

    dates = [r[0] for r in rows]
    quantities = [float(r[1]) for r in rows]
    forecast = _calculate_forecast(dates, quantities, periods)

    return {
        "variant_id": variant_id,
        "periods": periods,
        "forecast": forecast,
        "total_orders": len(rows),
        "date_range": {"from": str(dates[0]), "to": str(dates[-1])},
        "ready": True,
    }


def _calculate_forecast(dates, quantities, periods):
    df = pd.DataFrame({"date": pd.to_datetime(dates), "qty": quantities})
    df = df.set_index("date").resample("D").sum().fillna(0)

    # 14-day moving average
    ma14 = df["qty"].rolling(14, min_periods=1).mean().iloc[-1]

    # Simple trend: last 14 days vs previous 14
    if len(df) >= 28:
        recent = df["qty"].tail(14).mean()
        previous = df["qty"].iloc[-28:-14].mean()
        trend_per_day = (recent - previous) / 14.0 if previous > 0 else 0.0
    else:
        trend_per_day = 0.0

    result = []
    last_date = df.index[-1]
    for i in range(1, periods + 1):
        future_date = last_date + timedelta(days=i)
        val = ma14 + (trend_per_day * i)
        val = max(0.0, val)
        result.append({"date": str(future_date.date()), "qty": round(float(val), 2)})

    return result
