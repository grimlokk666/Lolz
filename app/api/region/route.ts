import { NextResponse } from "next/server";
import { query, isDatabaseAvailable } from "@/lib/db";
import {
  FALLBACK_AUDIO,
  FALLBACK_FLOCK,
  FALLBACK_WEBCAMS,
  filterByRadius,
} from "@/lib/fallback-data";
import { fetchAirspace } from "@/lib/airspace";
import { fetchFlockFromOverpass } from "@/lib/flock";
import { mergeFlockCameras } from "@/lib/flock-merge";
import {
  clampLat,
  clampLon,
  clampRadiusMiles,
  milesToMeters,
} from "@/lib/utils";
import type { AudioFeed, FlockCamera, WebcamAsset } from "@/types/master-eye";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface WebcamRow {
  id: string;
  ip: string;
  port: number;
  product: string | null;
  title: string | null;
  city: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number;
  longitude: number;
  snapshot_url: string | null;
  stream_url: string | null;
  protocol: string;
  tags: string[] | null;
  is_active: boolean;
  distance_m: number;
}

interface AudioRow {
  id: string;
  name: string;
  feed_type: AudioFeed["feedType"];
  description: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number;
  longitude: number;
  stream_url: string;
  website_url: string | null;
  frequency: string | null;
  is_active: boolean;
  distance_m: number;
}

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
  distance_m: number;
}

function mapWebcam(row: WebcamRow): WebcamAsset {
  return {
    id: row.id,
    ip: String(row.ip),
    port: row.port,
    product: row.product,
    title: row.title,
    city: row.city,
    country: row.country,
    countryCode: row.country_code,
    latitude: row.latitude,
    longitude: row.longitude,
    snapshotUrl: row.snapshot_url,
    streamUrl: row.stream_url,
    protocol: row.protocol,
    tags: row.tags ?? [],
    distanceM: row.distance_m,
    isActive: row.is_active,
  };
}

function mapAudio(row: AudioRow): AudioFeed {
  return {
    id: row.id,
    name: row.name,
    feedType: row.feed_type,
    description: row.description,
    city: row.city,
    region: row.region,
    country: row.country,
    countryCode: row.country_code,
    latitude: row.latitude,
    longitude: row.longitude,
    streamUrl: row.stream_url,
    websiteUrl: row.website_url,
    frequency: row.frequency,
    distanceM: row.distance_m,
    isActive: row.is_active,
  };
}

function mapFlock(row: FlockRow): FlockCamera {
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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let lat = Number(searchParams.get("lat"));
    let lon = Number(searchParams.get("lon"));
    let radiusMiles = Number(
      searchParams.get("radiusMiles") ??
        process.env.NEXT_PUBLIC_DEFAULT_RADIUS_MILES ??
        25
    );

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json(
        { error: "lat and lon query parameters are required" },
        { status: 400 }
      );
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return NextResponse.json(
        { error: "lat/lon out of range" },
        { status: 400 }
      );
    }

    lat = clampLat(lat);
    lon = clampLon(lon);
    radiusMiles = clampRadiusMiles(radiusMiles);
    const radiusMeters = milesToMeters(radiusMiles);
    let webcams: WebcamAsset[] = [];
    let audioFeeds: AudioFeed[] = [];
    let flockCameras: FlockCamera[] = [];
    let spatialSource = "fallback";
    let flockSource = "fallback";

    const dbOk = await isDatabaseAvailable();
    if (dbOk) {
      const [webcamResult, audioResult, flockResult] = await Promise.all([
        query<WebcamRow>(
          `SELECT id, ip::text AS ip, port, product, title, city, country, country_code,
                  latitude, longitude, snapshot_url, stream_url, protocol, tags, is_active,
                  ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_m
           FROM webcams
           WHERE is_active = TRUE
             AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
           ORDER BY distance_m ASC
           LIMIT 100`,
          [lat, lon, radiusMeters]
        ),
        query<AudioRow>(
          `SELECT id, name, feed_type, description, city, region, country, country_code,
                  latitude, longitude, stream_url, website_url, frequency, is_active,
                  ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_m
           FROM audio_feeds
           WHERE is_active = TRUE
             AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
           ORDER BY distance_m ASC
           LIMIT 100`,
          [lat, lon, radiusMeters]
        ),
        query<FlockRow>(
          `SELECT id, osm_id, name, manufacturer, model, operator, city, state, country, country_code,
                  latitude, longitude, direction, surveillance_type, source, tags, is_active,
                  ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_m
           FROM flock_cameras
           WHERE is_active = TRUE
             AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
           ORDER BY distance_m ASC
           LIMIT 250`,
          [lat, lon, radiusMeters]
        ),
      ]);
      webcams = webcamResult.rows.map(mapWebcam);
      audioFeeds = audioResult.rows.map(mapAudio);
      flockCameras = flockResult.rows.map(mapFlock);
      spatialSource = "postgis";
      flockSource = flockCameras.length > 0 ? "postgis" : "postgis-empty";
    } else {
      webcams = filterByRadius(FALLBACK_WEBCAMS, lat, lon, radiusMeters);
      audioFeeds = filterByRadius(FALLBACK_AUDIO, lat, lon, radiusMeters);
      flockCameras = filterByRadius(FALLBACK_FLOCK, lat, lon, radiusMeters);
    }

    // Live Overpass enrichment + airspace in parallel so Overpass never
    // serializes behind the critical sector path alone.
    const needOverpass = flockCameras.length < 5;
    const [liveResult, airspace] = await Promise.all([
      needOverpass
        ? fetchFlockFromOverpass({ lat, lon, radiusMeters }).catch(() => null)
        : Promise.resolve(null),
      fetchAirspace({ lat, lon, radiusMeters }),
    ]);

    if (liveResult && liveResult.cameras.length > 0) {
      flockCameras = mergeFlockCameras(flockCameras, liveResult.cameras, 250).sort(
        (a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0)
      );
      flockSource =
        flockSource === "fallback" || flockSource.includes("empty")
          ? liveResult.source
          : `${flockSource}+${liveResult.source}`;
    } else if (needOverpass && flockCameras.length === 0) {
      flockCameras = filterByRadius(FALLBACK_FLOCK, lat, lon, radiusMeters);
      flockSource = "fallback";
    }

    if (dbOk) {
      try {
        await query(
          `INSERT INTO inspection_events
             (latitude, longitude, radius_m, webcam_count, audio_count, aircraft_count, flock_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            lat,
            lon,
            radiusMeters,
            webcams.length,
            audioFeeds.length,
            airspace.aircraft.length,
            flockCameras.length,
          ]
        );
        // Opportunistic retention (cheap enough; indexed by created_at)
        if (Math.random() < 0.1) {
          await query(
            `DELETE FROM inspection_events WHERE created_at < NOW() - INTERVAL '7 days'`
          );
        }
      } catch {
        // non-fatal
      }
    }

    return NextResponse.json({
      latitude: lat,
      longitude: lon,
      radiusMiles,
      radiusMeters,
      webcams,
      audioFeeds,
      aircraft: airspace.aircraft,
      flockCameras,
      sources: {
        spatial: spatialSource,
        airspace: airspace.source,
        flock: flockSource,
      },
      queriedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Regional query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
