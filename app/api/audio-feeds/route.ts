import { NextResponse } from "next/server";
import { query, isDatabaseAvailable } from "@/lib/db";
import { FALLBACK_AUDIO } from "@/lib/fallback-data";
import type { AudioFeed } from "@/types/master-eye";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
}

export async function GET() {
  try {
    if (await isDatabaseAvailable()) {
      const { rows } = await query<AudioRow>(
        `SELECT id, name, feed_type, description, city, region, country, country_code,
                latitude, longitude, stream_url, website_url, frequency, is_active
         FROM audio_feeds
         WHERE is_active = TRUE
         ORDER BY name ASC
         LIMIT 500`
      );
      const feeds: AudioFeed[] = rows.map((row) => ({
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
        isActive: row.is_active,
      }));
      return NextResponse.json({ feeds, source: "postgis", count: feeds.length });
    }

    return NextResponse.json({
      feeds: FALLBACK_AUDIO,
      source: "fallback",
      count: FALLBACK_AUDIO.length,
    });
  } catch (error) {
    return NextResponse.json({
      feeds: FALLBACK_AUDIO,
      source: "fallback",
      count: FALLBACK_AUDIO.length,
      warning: error instanceof Error ? error.message : "db error",
    });
  }
}
