#!/usr/bin/env python3
"""
MASTER EYE — Automated Open Webcam OSINT Engine

Queries Shodan for publicly indexed webcam signatures, parses geo-metadata,
and upserts records into PostgreSQL/PostGIS so the Cesium globe can render
newly discovered streams.

Environment:
  SHODAN_API_KEY       — required for live Shodan queries
  DATABASE_URL         — PostgreSQL connection string
  WORKER_INTERVAL_SEC  — loop interval (default 300)
  WORKER_DEMO_MODE     — when true (default), seed demo cams if no API key
  SHODAN_QUERIES       — comma-separated override queries
"""

from __future__ import annotations

import logging
import os
import sys
import time
import random
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()
load_dotenv(".env.local")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [webcam-osint] %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("webcam_discovery")

DEFAULT_QUERIES: Sequence[str] = (
    'product:webcamxp has_screenshot:true',
    'product:"Yawcam" has_screenshot:true',
    'http.title:"WebcamXP" has_screenshot:true',
    'http.component:"IP Camera" has_screenshot:true',
    'port:554 has_screenshot:true "RTSP"',
)

DEMO_CAMERAS = [
    ("203.0.113.10", 80, "webcamxp", "Demo — Seattle Waterfront", "Seattle", "United States", "US", 47.6062, -122.3321),
    ("198.51.100.22", 8080, "axis", "Demo — Denver Stapleton Corridor", "Denver", "United States", "US", 39.7392, -104.9903),
    ("203.0.113.44", 80, "foscam", "Demo — Atlanta Hartsfield Perimeter", "Atlanta", "United States", "US", 33.6407, -84.4277),
    ("198.51.100.88", 554, "rtsp", "Demo — Boston Harbor Cam", "Boston", "United States", "US", 42.3601, -71.0589),
    ("203.0.113.91", 80, "hikvision", "Demo — Vancouver Harbour", "Vancouver", "Canada", "CA", 49.2827, -123.1207),
]


@dataclass
class WebcamRecord:
    ip: str
    port: int
    product: Optional[str]
    title: Optional[str]
    city: Optional[str]
    country: Optional[str]
    country_code: Optional[str]
    latitude: float
    longitude: float
    snapshot_url: Optional[str]
    stream_url: Optional[str]
    protocol: str
    shodan_host: Optional[str]
    tags: List[str]


class RateLimiter:
    """Simple token-interval limiter for Shodan API courtesy."""

    def __init__(self, min_interval_sec: float = 1.25) -> None:
        self.min_interval = min_interval_sec
        self._last = 0.0

    def wait(self) -> None:
        now = time.monotonic()
        delta = now - self._last
        if delta < self.min_interval:
            time.sleep(self.min_interval - delta)
        self._last = time.monotonic()


def get_db_conn():
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return psycopg2.connect(url)


def upsert_webcam(conn, cam: WebcamRecord) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO webcams (
              ip, port, product, title, city, country, country_code,
              latitude, longitude, snapshot_url, stream_url, protocol,
              shodan_host, tags, is_active, last_seen_at, updated_at
            ) VALUES (
              %(ip)s::inet, %(port)s, %(product)s, %(title)s, %(city)s, %(country)s, %(country_code)s,
              %(latitude)s, %(longitude)s, %(snapshot_url)s, %(stream_url)s, %(protocol)s,
              %(shodan_host)s, %(tags)s, TRUE, NOW(), NOW()
            )
            ON CONFLICT (ip, port) DO UPDATE SET
              product = EXCLUDED.product,
              title = COALESCE(EXCLUDED.title, webcams.title),
              city = COALESCE(EXCLUDED.city, webcams.city),
              country = COALESCE(EXCLUDED.country, webcams.country),
              country_code = COALESCE(EXCLUDED.country_code, webcams.country_code),
              latitude = EXCLUDED.latitude,
              longitude = EXCLUDED.longitude,
              snapshot_url = COALESCE(EXCLUDED.snapshot_url, webcams.snapshot_url),
              stream_url = COALESCE(EXCLUDED.stream_url, webcams.stream_url),
              protocol = EXCLUDED.protocol,
              shodan_host = EXCLUDED.shodan_host,
              tags = EXCLUDED.tags,
              is_active = TRUE,
              last_seen_at = NOW(),
              updated_at = NOW()
            """,
            {
                "ip": cam.ip,
                "port": cam.port,
                "product": cam.product,
                "title": cam.title,
                "city": cam.city,
                "country": cam.country,
                "country_code": cam.country_code,
                "latitude": cam.latitude,
                "longitude": cam.longitude,
                "snapshot_url": cam.snapshot_url,
                "stream_url": cam.stream_url,
                "protocol": cam.protocol,
                "shodan_host": cam.shodan_host,
                "tags": cam.tags,
            },
        )
    conn.commit()


def parse_shodan_match(match: dict) -> Optional[WebcamRecord]:
    loc = match.get("location") or {}
    lat = loc.get("latitude")
    lon = loc.get("longitude")
    if lat is None or lon is None:
        return None

    ip = match.get("ip_str")
    if not ip:
        return None

    port = int(match.get("port") or 80)
    product = match.get("product") or (match.get("http") or {}).get("server")
    title = (match.get("http") or {}).get("title") or product
    protocol = "rtsp" if port == 554 else "http"

    # Prefer Shodan-hosted screenshot when present
    snapshot = None
    opts = match.get("opts") or {}
    if opts.get("screenshot"):
        # Shodan does not always expose a direct URL; store host reference
        snapshot = f"https://www.shodan.io/host/{ip}"

    stream_url = f"{protocol}://{ip}:{port}/"
    tags = []
    for t in match.get("tags") or []:
        tags.append(str(t))
    if product:
        tags.append(str(product).lower())

    return WebcamRecord(
        ip=ip,
        port=port,
        product=str(product) if product else None,
        title=str(title)[:200] if title else None,
        city=loc.get("city"),
        country=loc.get("country_name"),
        country_code=loc.get("country_code"),
        latitude=float(lat),
        longitude=float(lon),
        snapshot_url=snapshot,
        stream_url=stream_url,
        protocol=protocol,
        shodan_host=ip,
        tags=tags[:12],
    )


def discover_via_shodan(api_key: str, queries: Sequence[str], limit_per_query: int = 40) -> List[WebcamRecord]:
    try:
        import shodan
    except ImportError as exc:
        raise RuntimeError("shodan package is required") from exc

    api = shodan.Shodan(api_key)
    limiter = RateLimiter(1.5)
    found: List[WebcamRecord] = []

    for query in queries:
        log.info("Shodan query: %s", query)
        try:
            limiter.wait()
            page = 1
            collected = 0
            while collected < limit_per_query:
                limiter.wait()
                try:
                    result = api.search(query, page=page)
                except shodan.APIError as err:
                    log.warning("Shodan API error for '%s': %s", query, err)
                    break

                matches = result.get("matches") or []
                if not matches:
                    break

                for match in matches:
                    if collected >= limit_per_query:
                        break
                    parsed = parse_shodan_match(match)
                    if parsed:
                        found.append(parsed)
                        collected += 1

                page += 1
                if page > 3:
                    break
        except Exception as err:  # noqa: BLE001 — isolate per-query failures
            log.exception("Query failed (%s): %s", query, err)
            time.sleep(2)

    return found


def discover_demo() -> List[WebcamRecord]:
    """Offline-safe discovery path for environments without Shodan credentials."""
    cams: List[WebcamRecord] = []
    for ip, port, product, title, city, country, cc, lat, lon in DEMO_CAMERAS:
        jitter_lat = lat + random.uniform(-0.01, 0.01)
        jitter_lon = lon + random.uniform(-0.01, 0.01)
        seed = abs(hash(ip)) % 10000
        cams.append(
            WebcamRecord(
                ip=ip,
                port=port,
                product=product,
                title=title,
                city=city,
                country=country,
                country_code=cc,
                latitude=jitter_lat,
                longitude=jitter_lon,
                snapshot_url=f"https://picsum.photos/seed/demo{seed}/640/360",
                stream_url=f"https://picsum.photos/seed/demo{seed}/1280/720",
                protocol="rtsp" if port == 554 else "http",
                shodan_host=None,
                tags=["demo", "osint", product],
            )
        )
    return cams


def persist(records: Iterable[WebcamRecord]) -> int:
    conn = get_db_conn()
    count = 0
    try:
        for cam in records:
            try:
                upsert_webcam(conn, cam)
                count += 1
            except Exception as err:  # noqa: BLE001
                log.warning("Upsert failed for %s:%s — %s", cam.ip, cam.port, err)
                conn.rollback()
    finally:
        conn.close()
    return count


def resolve_queries() -> Sequence[str]:
    raw = os.getenv("SHODAN_QUERIES", "").strip()
    if raw:
        return [q.strip() for q in raw.split(",") if q.strip()]
    return DEFAULT_QUERIES


def run_once() -> int:
    api_key = os.getenv("SHODAN_API_KEY", "").strip()
    demo_mode = os.getenv("WORKER_DEMO_MODE", "true").lower() in {"1", "true", "yes"}

    if api_key:
        records = discover_via_shodan(api_key, resolve_queries())
        log.info("Shodan returned %d geo-tagged webcam hosts", len(records))
    elif demo_mode:
        log.warning("No SHODAN_API_KEY — running demo discovery path")
        records = discover_demo()
    else:
        log.error("SHODAN_API_KEY missing and WORKER_DEMO_MODE disabled")
        return 0

    upserted = persist(records)
    log.info("Upserted %d webcam records into PostGIS", upserted)
    return upserted


def main() -> None:
    interval = int(os.getenv("WORKER_INTERVAL_SEC", "300"))
    log.info("MASTER EYE webcam OSINT worker starting (interval=%ss)", interval)

    while True:
        try:
            run_once()
        except Exception as err:  # noqa: BLE001
            log.exception("Worker cycle failed: %s", err)
        time.sleep(max(30, interval))


if __name__ == "__main__":
    # Support one-shot: python webcam_discovery.py --once
    if "--once" in sys.argv:
        try:
            run_once()
        except Exception as err:  # noqa: BLE001
            log.exception("One-shot failed: %s", err)
            sys.exit(1)
        sys.exit(0)
    main()
