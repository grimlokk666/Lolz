import { NextResponse } from "next/server";
import { query, isDatabaseAvailable } from "@/lib/db";
import { FALLBACK_WEBCAMS } from "@/lib/fallback-data";
import type { WebcamAsset } from "@/types/master-eye";

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
}

export async function GET() {
  try {
    if (await isDatabaseAvailable()) {
      const { rows } = await query<WebcamRow>(
        `SELECT id, ip::text AS ip, port, product, title, city, country, country_code,
                latitude, longitude, snapshot_url, stream_url, protocol, tags, is_active
         FROM webcams
         WHERE is_active = TRUE
         ORDER BY updated_at DESC
         LIMIT 500`
      );
      const webcams: WebcamAsset[] = rows.map((row) => ({
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
        isActive: row.is_active,
      }));
      return NextResponse.json({ webcams, source: "postgis", count: webcams.length });
    }

    return NextResponse.json({
      webcams: FALLBACK_WEBCAMS,
      source: "fallback",
      count: FALLBACK_WEBCAMS.length,
    });
  } catch (error) {
    return NextResponse.json({
      webcams: FALLBACK_WEBCAMS,
      source: "fallback",
      count: FALLBACK_WEBCAMS.length,
      warning: error instanceof Error ? error.message : "db error",
    });
  }
}
