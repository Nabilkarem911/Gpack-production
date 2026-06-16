"""
G.PACK AI Forecasting Service
Simple demand forecasting using rolling average + trend
"""

import os
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import psycopg2
from psycopg2 import pool as psycopg2_pool
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

DB_POOL_MIN = int(os.getenv('DB_POOL_MIN', '1'))
DB_POOL_MAX = int(os.getenv('DB_POOL_MAX', '5'))

# Create a module-level threaded connection pool for reuse
_db_pool = psycopg2_pool.ThreadedConnectionPool(
    minconn=DB_POOL_MIN,
    maxconn=DB_POOL_MAX,
    **DB_CONFIG
)


def get_db_connection():
    return _db_pool.getconn()


def put_db_connection(conn):
    _db_pool.putconn(conn)


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
        put_db_connection(conn)

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
        put_db_connection(conn)

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


@app.get("/insights/rfm")
def rfm_analysis():
    """Customer segmentation using RFM (Recency, Frequency, Monetary)."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    c.id,
                    c.name,
                    MAX(o.order_date)::date as last_order,
                    COUNT(o.id)::int as order_count,
                    COALESCE(SUM(o.grand_total), 0)::float as total_value
                FROM clients c
                LEFT JOIN orders o ON o.client_id = c.id
                    AND o.status NOT IN ('cancelled', 'draft')
                GROUP BY c.id, c.name
                ORDER BY total_value DESC
                """
            )
            rows = cur.fetchall()
    finally:
        put_db_connection(conn)

    if not rows:
        return {"segments": [], "total_clients": 0}

    today = datetime.now().date()
    data = []
    for r in rows:
        client_id, name, last_order, order_count, total_value = r
        recency = (today - last_order).days if last_order else 999
        data.append({
            "id": client_id,
            "name": name,
            "recency": recency,
            "frequency": order_count or 0,
            "monetary": total_value or 0,
            "last_order": str(last_order) if last_order else None,
        })

    df = pd.DataFrame(data)

    # Simple scoring (1-3 scale)
    df["R_score"] = pd.qcut(df["recency"].rank(method="first", ascending=False), 3, labels=[3, 2, 1], duplicates="drop").astype(int) if len(df) >= 3 else 2
    df["F_score"] = pd.qcut(df["frequency"].rank(method="first"), 3, labels=[1, 2, 3], duplicates="drop").astype(int) if len(df) >= 3 and df["frequency"].nunique() > 1 else 2
    df["M_score"] = pd.qcut(df["monetary"].rank(method="first"), 3, labels=[1, 2, 3], duplicates="drop").astype(int) if len(df) >= 3 and df["monetary"].nunique() > 1 else 2

    def classify(row):
        r, f, m = row["R_score"], row["F_score"], row["M_score"]
        if r >= 3 and f >= 2 and m >= 2:
            return "vip"
        elif r >= 2 and f >= 2:
            return "active"
        elif r == 1:
            return "dormant"
        else:
            return "at_risk"

    df["segment"] = df.apply(classify, axis=1)

    segments = {
        "vip": [],
        "active": [],
        "at_risk": [],
        "dormant": [],
    }

    for _, row in df.iterrows():
        segments[row["segment"]].append({
            "id": row["id"],
            "name": row["name"],
            "recency": int(row["recency"]),
            "frequency": int(row["frequency"]),
            "monetary": round(row["monetary"], 2),
            "last_order": row["last_order"],
        })

    return {
        "segments": segments,
        "counts": {k: len(v) for k, v in segments.items()},
        "total_clients": len(df),
    }


@app.get("/insights/churn")
def churn_alerts(days: int = 30):
    """Clients who have not ordered in the last N days."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    c.id,
                    c.name,
                    MAX(o.order_date)::date as last_order,
                    COUNT(o.id)::int as total_orders,
                    COALESCE(SUM(o.grand_total), 0)::float as total_value
                FROM clients c
                LEFT JOIN orders o ON o.client_id = c.id
                    AND o.status NOT IN ('cancelled', 'draft')
                GROUP BY c.id, c.name
                HAVING MAX(o.order_date) < CURRENT_DATE - INTERVAL '%s days'
                   OR MAX(o.order_date) IS NULL
                ORDER BY last_order DESC NULLS LAST
                """,
                (days,),
            )
            rows = cur.fetchall()
    finally:
        put_db_connection(conn)

    today = datetime.now().date()
    clients = []
    for r in rows:
        client_id, name, last_order, total_orders, total_value = r
        inactive_days = (today - last_order).days if last_order else 999
        clients.append({
            "id": client_id,
            "name": name,
            "inactive_days": inactive_days,
            "last_order": str(last_order) if last_order else None,
            "total_orders": total_orders or 0,
            "total_value": round(total_value or 0, 2),
        })

    return {
        "threshold_days": days,
        "clients": clients,
        "count": len(clients),
    }
