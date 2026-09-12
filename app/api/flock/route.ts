import { NextResponse } from "next/server";
import { query, isDatabaseAvailable } from "@/lib/db";
import { FALLBACK_FLOCK, filterByRadius } from "@/lib/fallback-data";
import { fetchFlockFromOverpass } from "@/lib/flock";
import { milesToMeters } from "@/lib/utils";
import type { FlockCamera } from "@/types/master-eye";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface FlockRow {
  id: string;
  osm_id: string | null;
  name: string | null;
  manufacturer: string | null;
  model: string | null;
  operator: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number;
  longitude: number;
  direction: number | null;
  surveillance_type: string;
  source: string;
  tags: string[] | null;
  is_active: boolean;
  distance_m?: number;
}

function mapRow(row: FlockRow): FlockCamera {
  return {
    id: row.id,
    osmId: row.osm_id,
    name: row.name,
    manufacturer: row.manufacturer,
    model: row.model,
    operator: row.operator,
    city: row.city,
    state: row.state,
    country: row.country,
    countryCode: row.country_code,
    latitude: row.latitude,
    longitude: row.longitude,
    direction: row.direction,
    surveillanceType: row.surveillance_type || "ALPR",
    source: (row.source as FlockCamera["source"]) || "database",
    tags: row.tags ?? [],
    distanceM: row.distance_m,
    isActive: row.is_active,
  };
}

async function upsertOverpassCameras(cameras: FlockCamera[]): Promise<void> {
  for (const cam of cameras.slice(0, 200)) {
    try {
      await query(
        `INSERT INTO flock_cameras (
           osm_id, name, manufacturer, model, operator, city, state, country, country_code,
           latitude, longitude, direction, surveillance_type, source, tags, is_active, last_seen_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'overpass',$14,TRUE,NOW(),NOW()
         )
         ON CONFLICT (osm_id) DO UPDATE SET
           name = EXCLUDED.name,
           manufacturer = EXCLUDED.manufacturer,
           model = EXCLUDED.model,
           operator = EXCLUDED.operator,
           city = COALESCE(EXCLUDED.city, flock_cameras.city),
           state = COALESCE(EXCLUDED.state, flock_cameras.state),
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           direction = EXCLUDED.direction,
           tags = EXCLUDED.tags,
           is_active = TRUE,
           last_seen_at = NOW(),
           updated_at = NOW()`,
        [
          cam.osmId,
          cam.name,
          cam.manufacturer,
          cam.model,
          cam.operator,
          cam.city,
          cam.state,
          cam.country,
          cam.countryCode,
          cam.latitude,
          cam.longitude,
          cam.direction,
          cam.surveillanceType,
          cam.tags,
        ]
      );
    } catch {
      // non-fatal per-row
    }
  }
}

/**
 * GET /api/flock
 *  - no params: global catalog (PostGIS or seed)
 *  - ?lat=&lon=&radiusMiles=: live Overpass ALPR pull + PostGIS radius + seed fallback
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get("lat");
    const lon = searchParams.get("lon");
    const radiusMiles = Number(
      searchParams.get("radiusMiles") ??
        process.env.NEXT_PUBLIC_DEFAULT_RADIUS_MILES ??
        25
    );
    const live = searchParams.get("live") !== "0";

    // Regional live pull
    if (lat != null && lon != null) {
      const latitude = Number(lat);
      const longitude = Number(lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return NextResponse.json(
          { error: "lat and lon must be numeric" },
          { status: 400 }
        );
      }

      const radiusMeters = milesToMeters(radiusMiles);
      let cameras: FlockCamera[] = [];
      let source = "fallback";

      if (live) {
        try {
          const overpass = await fetchFlockFromOverpass({
            lat: latitude,
            lon: longitude,
            radiusMeters,
          });
          cameras = overpass.cameras;
          source = overpass.source;
          if (cameras.length > 0 && (await isDatabaseAvailable())) {
            void upsertOverpassCameras(cameras);
          }
        } catch {
          // fall through to DB / seed
        }
      }

      if (cameras.length === 0 && (await isDatabaseAvailable())) {
        const { rows } = await query<FlockRow>(
          `SELECT id, osm_id, name, manufacturer, model, operator, city, state, country, country_code,
                  latitude, longitude, direction, surveillance_type, source, tags, is_active,
                  ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_m
           FROM flock_cameras
           WHERE is_active = TRUE
             AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
           ORDER BY distance_m ASC
           LIMIT 250`,
          [latitude, longitude, radiusMeters]
        );
        cameras = rows.map(mapRow);
        source = "postgis";
      }

      if (cameras.length === 0) {
        cameras = filterByRadius(FALLBACK_FLOCK, latitude, longitude, radiusMeters);
        source = "fallback";
      }

      return NextResponse.json({
        cameras,
        count: cameras.length,
        source,
        latitude,
        longitude,
        radiusMiles,
        queriedAt: new Date().toISOString(),
      });
    }

    // Global catalog for globe layer
    if (await isDatabaseAvailable()) {
      const { rows } = await query<FlockRow>(
        `SELECT id, osm_id, name, manufacturer, model, operator, city, state, country, country_code,
                latitude, longitude, direction, surveillance_type, source, tags, is_active
         FROM flock_cameras
         WHERE is_active = TRUE
         ORDER BY updated_at DESC
         LIMIT 2000`
      );
      if (rows.length > 0) {
        const cameras = rows.map(mapRow);
        return NextResponse.json({
          cameras,
          count: cameras.length,
          source: "postgis",
          queriedAt: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({
      cameras: FALLBACK_FLOCK,
      count: FALLBACK_FLOCK.length,
      source: "fallback",
      queriedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({
      cameras: FALLBACK_FLOCK,
      count: FALLBACK_FLOCK.length,
      source: "fallback",
      warning: error instanceof Error ? error.message : "flock query failed",
      queriedAt: new Date().toISOString(),
    });
  }
}
