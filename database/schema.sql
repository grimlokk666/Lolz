-- MASTER EYE — PostgreSQL + PostGIS schema
-- Spatial intelligence store for webcams, audio nodes, and telemetry cache

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Discovered open webcams (Shodan / OSINT ingestion)
CREATE TABLE IF NOT EXISTS webcams (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip            INET NOT NULL,
  port          INTEGER NOT NULL DEFAULT 80,
  product       TEXT,
  title         TEXT,
  city          TEXT,
  country       TEXT,
  country_code  CHAR(2),
  latitude      DOUBLE PRECISION NOT NULL,
  longitude     DOUBLE PRECISION NOT NULL,
  location      GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
                  ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
                ) STORED,
  snapshot_url  TEXT,
  stream_url    TEXT,
  protocol      TEXT DEFAULT 'http',
  shodan_host   TEXT,
  tags          TEXT[] DEFAULT '{}',
  is_active     BOOLEAN DEFAULT TRUE,
  last_seen_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (ip, port)
);

CREATE INDEX IF NOT EXISTS idx_webcams_location ON webcams USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_webcams_active ON webcams (is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_webcams_country ON webcams (country_code);

-- Emergency / aviation audio feed nodes
CREATE TABLE IF NOT EXISTS audio_feeds (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  feed_type     TEXT NOT NULL CHECK (feed_type IN ('aviation', 'emergency', 'police', 'fire', 'marine', 'other')),
  description   TEXT,
  city          TEXT,
  region        TEXT,
  country       TEXT,
  country_code  CHAR(2),
  latitude      DOUBLE PRECISION NOT NULL,
  longitude     DOUBLE PRECISION NOT NULL,
  location      GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
                  ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
                ) STORED,
  stream_url    TEXT NOT NULL,
  website_url   TEXT,
  frequency     TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audio_feeds_location ON audio_feeds USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_audio_feeds_type ON audio_feeds (feed_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_feeds_name_coords
  ON audio_feeds (name, latitude, longitude);

-- Cached aircraft positions (optional telemetry bridge cache)
CREATE TABLE IF NOT EXISTS aircraft_snapshots (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  icao24        VARCHAR(6) NOT NULL,
  callsign      TEXT,
  origin_country TEXT,
  latitude      DOUBLE PRECISION NOT NULL,
  longitude     DOUBLE PRECISION NOT NULL,
  location      GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
                  ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
                ) STORED,
  altitude_m    DOUBLE PRECISION,
  velocity_ms   DOUBLE PRECISION,
  heading       DOUBLE PRECISION,
  vertical_rate DOUBLE PRECISION,
  squawk        TEXT,
  on_ground     BOOLEAN DEFAULT FALSE,
  recorded_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aircraft_location ON aircraft_snapshots USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_aircraft_icao ON aircraft_snapshots (icao24);
CREATE INDEX IF NOT EXISTS idx_aircraft_recorded ON aircraft_snapshots (recorded_at DESC);

-- Regional inspection query log (ops telemetry)
CREATE TABLE IF NOT EXISTS inspection_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  latitude      DOUBLE PRECISION NOT NULL,
  longitude     DOUBLE PRECISION NOT NULL,
  radius_m      INTEGER NOT NULL DEFAULT 40233,
  webcam_count  INTEGER DEFAULT 0,
  audio_count   INTEGER DEFAULT 0,
  aircraft_count INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial query helper: assets within radius (meters)
CREATE OR REPLACE FUNCTION assets_within_radius(
  p_lat DOUBLE PRECISION,
  p_lon DOUBLE PRECISION,
  p_radius_m DOUBLE PRECISION DEFAULT 40233
)
RETURNS TABLE (
  asset_type TEXT,
  asset_id UUID,
  name TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  distance_m DOUBLE PRECISION,
  metadata JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    'webcam'::TEXT,
    w.id,
    COALESCE(w.title, w.product, w.ip::TEXT),
    w.latitude,
    w.longitude,
    ST_Distance(w.location, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography),
    jsonb_build_object(
      'ip', w.ip,
      'port', w.port,
      'city', w.city,
      'country', w.country,
      'snapshot_url', w.snapshot_url,
      'stream_url', w.stream_url,
      'protocol', w.protocol,
      'tags', w.tags
    )
  FROM webcams w
  WHERE w.is_active = TRUE
    AND ST_DWithin(
      w.location,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
      p_radius_m
    )

  UNION ALL

  SELECT
    'audio'::TEXT,
    a.id,
    a.name,
    a.latitude,
    a.longitude,
    ST_Distance(a.location, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography),
    jsonb_build_object(
      'feed_type', a.feed_type,
      'description', a.description,
      'city', a.city,
      'country', a.country,
      'stream_url', a.stream_url,
      'frequency', a.frequency
    )
  FROM audio_feeds a
  WHERE a.is_active = TRUE
    AND ST_DWithin(
      a.location,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
      p_radius_m
    )
  ORDER BY 6 ASC;
END;
$$ LANGUAGE plpgsql STABLE;
