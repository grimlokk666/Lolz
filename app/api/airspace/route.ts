import { NextResponse } from "next/server";
import { aircraftToGeoJSON, fetchAirspace } from "@/lib/airspace";
import { milesToMeters } from "@/lib/utils";

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

    const result = await fetchAirspace({
      lat: lat != null ? Number(lat) : undefined,
      lon: lon != null ? Number(lon) : undefined,
      radiusMeters: milesToMeters(radiusMiles),
      lamin: lamin != null ? Number(lamin) : undefined,
      lamax: lamax != null ? Number(lamax) : undefined,
      lomin: lomin != null ? Number(lomin) : undefined,
      lomax: lomax != null ? Number(lomax) : undefined,
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
