# MASTER EYE

Real-time tactical global intelligence and surveillance dashboard. CesiumJS globe with live aircraft (OpenSky / ADS-B), OSINT webcam markers (Shodan worker → PostGIS), and emergency/aviation audio nodes with an Icecast/Shoutcast proxy.

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | Next.js 14 App Router, TypeScript, Tailwind, Radix/Shadcn-style UI, Lucide, Zustand |
| Globe | CesiumJS + Resium |
| API | Next.js Route Handlers (`/api/airspace`, `/api/audio-proxy`, `/api/region`, …) |
| DB | PostgreSQL + PostGIS |
| Telemetry bridge | Express + WebSocket (`services/telemetry`) |
| OSINT workers | Python Shodan webcam discovery + Flock/ALPR Overpass ingest (`workers/`) |

## Quick start

```bash
# 1. Install
npm install
pip3 install -r workers/requirements.txt

# 2. Environment
cp .env.example .env.local

# 3. Database (optional — app falls back to seeded in-memory data)
docker compose up -d postgis

# 4. Dev servers
npm run dev:all
# web → http://localhost:3000
# telemetry → http://localhost:4100
```

Optional one-shot webcam worker (demo mode without `SHODAN_API_KEY`):

```bash
npm run worker:webcams
```

## Modules

- **`components/GlobeView.tsx`** — full-screen Cesium viewer, layer entities, click → fly-to
- **`components/RegionalInspector.tsx`** — cams / airspace / audio inspector drawer
- **`workers/webcam_discovery.py`** — Shodan OSINT ingest with rate limiting + PostGIS upsert
- **`workers/flock_discovery.py`** — Overpass OSM ALPR / Flock Safety camera ingest (DeFlock-class public tags)
- **`/api/flock`** — global + regional Flock/ALPR layer (live Overpass with PostGIS/seed fallback)
- HUD **Flock ALPR** layer + Regional Inspector **Flock** tab
- **`app/api/airspace`** — OpenSky / ADS-B proxy, GeoJSON option, demo fallback
- **`app/api/audio-proxy`** — allowlisted Icecast/Shoutcast CORS/protocol bridge
- **`app/api/region`** — PostGIS `ST_DWithin` sector query (±25 mi default)

## Design

Dark tactical HUD: obsidian `#030712`, cyan borders, glassmorphism panels (`backdrop-blur-md bg-black/70`), monospace telemetry.

## Environment

See `.env.example` for `DATABASE_URL`, `SHODAN_API_KEY`, `NEXT_PUBLIC_CESIUM_ION_TOKEN`, OpenSky OAuth (`OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` from your OpenSky `credentials.json`), and ADS-B RapidAPI keys.
