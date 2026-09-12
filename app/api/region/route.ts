import { NextResponse } from "next/server";
import { query, isDatabaseAvailable } from "@/lib/db";
import {
  FALLBACK_AUDIO,
  FALLBACK_WEBCAMS,
  filterByRadius,
} from "@/lib/fallback-data";
import { fetchAirspace } from "@/lib/airspace";
import { milesToMeters } from "@/lib/utils";
import type { AudioFeed, WebcamAsset } from "@/types/master-eye";

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = Number(searchParams.get("lat"));
    const lon = Number(searchParams.get("lon"));
    const radiusMiles = Number(
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

    const radiusMeters = milesToMeters(radiusMiles);
    let webcams: WebcamAsset[] = [];
    let audioFeeds: AudioFeed[] = [];
    let source = "fallback";

    const dbOk = await isDatabaseAvailable();
    if (dbOk) {
      const [webcamResult, audioResult] = await Promise.all([
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
      ]);
      webcams = webcamResult.rows.map(mapWebcam);
      audioFeeds = audioResult.rows.map(mapAudio);
      source = "postgis";

      try {
        await query(
          `INSERT INTO inspection_events (latitude, longitude, radius_m, webcam_count, audio_count)
           VALUES ($1, $2, $3, $4, $5)`,
          [lat, lon, radiusMeters, webcams.length, audioFeeds.length]
        );
      } catch {
        // non-fatal
      }
    } else {
      webcams = filterByRadius(FALLBACK_WEBCAMS, lat, lon, radiusMeters);
      audioFeeds = filterByRadius(FALLBACK_AUDIO, lat, lon, radiusMeters);
    }

    const airspace = await fetchAirspace({
      lat,
      lon,
      radiusMeters,
    });

    return NextResponse.json({
      latitude: lat,
      longitude: lon,
      radiusMiles,
      radiusMeters,
      webcams,
      audioFeeds,
      aircraft: airspace.aircraft,
      sources: { spatial: source, airspace: airspace.source },
      queriedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Regional query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
