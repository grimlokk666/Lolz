#!/usr/bin/env python3
"""MASTER EYE — Flock / ALPR Overpass ingestion worker."""
from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

import psycopg2
import requests
from dotenv import load_dotenv

load_dotenv()
load_dotenv(".env.local")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [flock-osint] %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("flock_discovery")

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

BBOXES: Sequence[Tuple[float, float, float, float]] = (
    (40.48, -74.28, 40.95, -73.68),
    (33.70, -118.55, 34.25, -118.10),
    (41.70, -87.95, 42.05, -87.50),
    (33.65, -84.55, 33.90, -84.25),
    (29.65, -95.55, 29.90, -95.20),
    (25.70, -80.35, 25.90, -80.10),
    (37.70, -122.55, 37.85, -122.35),
    (47.50, -122.45, 47.70, -122.25),
    (39.65, -105.10, 39.85, -104.85),
    (33.35, -112.20, 33.55, -111.90),
)

DEMO = [
    ("seed-nyc-1", "Flock Falcon — Midtown E 42nd", "Flock Safety", "Falcon", "New York", "NY", 40.7516, -73.9755),
    ("seed-nyc-2", "Flock Falcon — FDR / 34th", "Flock Safety", "Falcon", "New York", "NY", 40.7441, -73.9721),
    ("seed-jfk-1", "Flock Falcon — JFK Van Wyck", "Flock Safety", "Falcon", "Queens", "NY", 40.6586, -73.7956),
    ("seed-lax-1", "Flock Falcon — Century / LAX", "Flock Safety", "Falcon", "Los Angeles", "CA", 33.9456, -118.3947),
    ("seed-chi-1", "Flock Falcon — Loop Wacker", "Flock Safety", "Falcon", "Chicago", "IL", 41.8865, -87.6368),
]


def connect():
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return psycopg2.connect(url)


def make_ql(bbox: Tuple[float, float, float, float]) -> str:
    s, w, n, e = bbox
    return f"""
[out:json][timeout:45];
(
  node["surveillance:type"="ALPR"]({s},{w},{n},{e});
  node["surveillance:type"="anpr"]({s},{w},{n},{e});
  node["manufacturer"="Flock Safety"]({s},{w},{n},{e});
  node["manufacturer"="Flock"]({s},{w},{n},{e});
  node["brand"="Flock Safety"]({s},{w},{n},{e});
);
out body;
""".strip()


def fetch_bbox(bbox: Tuple[float, float, float, float]) -> List[Dict[str, Any]]:
    ql = make_ql(bbox)
    last_err: Optional[Exception] = None
    for url in OVERPASS_URLS:
        try:
            r = requests.post(
                url,
                data={"data": ql},
                headers={"User-Agent": "MASTER-EYE/1.0 (flock-osint)"},
                timeout=50,
            )
            r.raise_for_status()
            return list((r.json() or {}).get("elements") or [])
        except Exception as e:  # noqa: BLE001
            last_err = e
            log.warning("Overpass %s failed: %s", url, e)
            time.sleep(1.5)
    if last_err:
        raise last_err
    return []


_CARDINAL = {
    "n": 0,
    "north": 0,
    "ne": 45,
    "northeast": 45,
    "e": 90,
    "east": 90,
    "se": 135,
    "southeast": 135,
    "s": 180,
    "south": 180,
    "sw": 225,
    "southwest": 225,
    "w": 270,
    "west": 270,
    "nw": 315,
    "northwest": 315,
}


def parse_direction(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    text = raw.strip()
    try:
        return float(text) % 360.0
    except ValueError:
        pass
    key = text.lower().replace("facing ", "").replace(" ", "")
    key = "".join(ch for ch in key if ch.isalpha())
    return float(_CARDINAL[key]) if key in _CARDINAL else None


def normalize(el: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    lat, lon = el.get("lat"), el.get("lon")
    if lat is None or lon is None:
        return None
    tags = el.get("tags") or {}
    # Never infer Flock from wikidata alone.
    mfr_raw = tags.get("manufacturer") or tags.get("brand")
    hay = " ".join(
        filter(
            None,
            [
                mfr_raw,
                tags.get("operator"),
                tags.get("owner"),
                tags.get("name"),
                tags.get("brand"),
            ],
        )
    )
    is_flock = "flock" in hay.lower()
    mfr = mfr_raw or ("Flock Safety" if is_flock else "ALPR Node")
    tag_list = ["alpr"]
    if is_flock:
        tag_list.append("flock")
    for k in ("surveillance:type", "model", "operator", "direction"):
        if tags.get(k):
            tag_list.append(f"{k}={tags[k]}")
    return {
        "osm_id": str(el.get("id")),
        "name": tags.get("name") or tags.get("ref"),
        "manufacturer": mfr,
        "model": tags.get("model") or tags.get("camera:model"),
        "operator": tags.get("operator") or tags.get("owner"),
        "city": tags.get("addr:city"),
        "state": tags.get("addr:state"),
        "country": tags.get("addr:country") or "United States",
        "country_code": (
            tags.get("addr:country")
            if tags.get("addr:country") and len(tags.get("addr:country")) == 2
            else "US"
        ),
        "latitude": float(lat),
        "longitude": float(lon),
        "direction": parse_direction(tags.get("direction")),
        "surveillance_type": (tags.get("surveillance:type") or "ALPR").upper(),
        "tags": tag_list[:12],
        "raw_tags": json.dumps(tags),
    }


def upsert(conn, cam: Dict[str, Any]) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO flock_cameras (
              osm_id, name, manufacturer, model, operator, city, state, country, country_code,
              latitude, longitude, direction, surveillance_type, source, tags, raw_tags,
              is_active, last_seen_at, updated_at
            ) VALUES (
              %(osm_id)s, %(name)s, %(manufacturer)s, %(model)s, %(operator)s, %(city)s, %(state)s,
              %(country)s, %(country_code)s, %(latitude)s, %(longitude)s, %(direction)s,
              %(surveillance_type)s, 'overpass', %(tags)s, %(raw_tags)s::jsonb,
              TRUE, NOW(), NOW()
            )
            ON CONFLICT (osm_id) DO UPDATE SET
              name = COALESCE(EXCLUDED.name, flock_cameras.name),
              manufacturer = EXCLUDED.manufacturer,
              model = COALESCE(EXCLUDED.model, flock_cameras.model),
              operator = COALESCE(EXCLUDED.operator, flock_cameras.operator),
              city = COALESCE(EXCLUDED.city, flock_cameras.city),
              state = COALESCE(EXCLUDED.state, flock_cameras.state),
              latitude = EXCLUDED.latitude,
              longitude = EXCLUDED.longitude,
              direction = COALESCE(EXCLUDED.direction, flock_cameras.direction),
              tags = EXCLUDED.tags,
              raw_tags = EXCLUDED.raw_tags,
              is_active = TRUE,
              last_seen_at = NOW(),
              updated_at = NOW()
            """,
            cam,
        )
    conn.commit()


def seed_demo(conn) -> int:
    n = 0
    for osm_id, name, mfr, model, city, state, lat, lon in DEMO:
        upsert(
            conn,
            {
                "osm_id": osm_id,
                "name": name,
                "manufacturer": mfr,
                "model": model,
                "operator": "demo",
                "city": city,
                "state": state,
                "country": "United States",
                "country_code": "US",
                "latitude": lat,
                "longitude": lon,
                "direction": None,
                "surveillance_type": "ALPR",
                "tags": ["flock", "alpr", "demo"],
                "raw_tags": "{}",
            },
        )
        n += 1
    return n


def run_once() -> int:
    demo = os.getenv("WORKER_DEMO_MODE", "true").lower() in {"1", "true", "yes"}
    conn = connect()
    total = 0
    try:
        for bbox in BBOXES:
            log.info("Overpass bbox %s", bbox)
            try:
                elements = fetch_bbox(bbox)
            except Exception as e:  # noqa: BLE001
                log.warning("bbox failed: %s", e)
                time.sleep(2)
                continue
            for el in elements:
                cam = normalize(el)
                if not cam:
                    continue
                try:
                    upsert(conn, cam)
                    total += 1
                except Exception as e:  # noqa: BLE001
                    log.warning("upsert %s failed: %s", cam.get("osm_id"), e)
                    conn.rollback()
            time.sleep(2)
        if total == 0 and demo:
            log.warning("no Overpass hits — seeding demo Flock nodes")
            total = seed_demo(conn)
    finally:
        conn.close()
    log.info("upserted %d cameras", total)
    return total


def main() -> None:
    interval = int(os.getenv("WORKER_INTERVAL_SEC", "600"))
    log.info("flock/ALPR worker online (interval=%ss)", interval)
    while True:
        try:
            run_once()
        except Exception as e:  # noqa: BLE001
            log.exception("cycle failed: %s", e)
        time.sleep(max(60, interval))


if __name__ == "__main__":
    if "--once" in sys.argv:
        try:
            run_once()
        except Exception as e:  # noqa: BLE001
            log.exception("one-shot failed: %s", e)
            sys.exit(1)
        sys.exit(0)
    main()
