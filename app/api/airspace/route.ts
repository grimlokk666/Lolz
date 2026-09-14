import { NextResponse } from "next/server";
import { aircraftToGeoJSON, fetchAirspace } from "@/lib/airspace";
import {
  clampLat,
  clampLon,
  clampRadiusMiles,
  milesToMeters,
} from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get("lat");
    const lon = searchParams.get("lon");
    const lamin = searchParams.get("lamin");
    const lamax = searchParams.get("lamax");
    const lomin = searchParams.get("lomin");
    const lomax = searchParams.get("lomax");
    const radiusMiles = Number(
      searchParams.get("radiusMiles") ??
        process.env.NEXT_PUBLIC_DEFAULT_RADIUS_MILES ??
        25
    );
    const format = searchParams.get("format") ?? "json";

    const clampBox = (v: number | undefined, min: number, max: number) =>
      v == null || !Number.isFinite(v) ? undefined : Math.max(min, Math.min(max, v));

    const result = await fetchAirspace({
      lat: lat != null ? clampLat(Number(lat)) : undefined,
      lon: lon != null ? clampLon(Number(lon)) : undefined,
      radiusMeters: milesToMeters(clampRadiusMiles(radiusMiles)),
      lamin: clampBox(lamin != null ? Number(lamin) : undefined, -90, 90),
      lamax: clampBox(lamax != null ? Number(lamax) : undefined, -90, 90),
      lomin: clampBox(lomin != null ? Number(lomin) : undefined, -180, 180),
      lomax: clampBox(lomax != null ? Number(lomax) : undefined, -180, 180),
    });

    if (format === "geojson") {
      return NextResponse.json({
        ...aircraftToGeoJSON(result.aircraft),
        meta: {
          source: result.source,
          count: result.aircraft.length,
          queriedAt: new Date().toISOString(),
        },
      });
    }

    return NextResponse.json({
      aircraft: result.aircraft,
      source: result.source,
      count: result.aircraft.length,
      queriedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Airspace query failed";
    return NextResponse.json(
      { error: message, aircraft: [], source: "error", count: 0 },
      { status: 500 }
    );
  }
}
