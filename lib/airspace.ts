import type { Aircraft } from "@/types/master-eye";
import { bboxFromCenter } from "@/lib/utils";
import { generateDemoAircraft } from "@/lib/fallback-data";

interface OpenSkyState {
  icao24: string;
  callsign: string | null;
  origin_country: string;
  time_position: number | null;
  last_contact: number;
  longitude: number | null;
  latitude: number | null;
  baro_altitude: number | null;
  on_ground: boolean;
  velocity: number | null;
  true_track: number | null;
  vertical_rate: number | null;
  sensors: number[] | null;
  geo_altitude: number | null;
  squawk: string | null;
  spi: boolean;
  position_source: number;
}

function mapOpenSky(state: OpenSkyState): Aircraft | null {
  if (state.latitude == null || state.longitude == null) return null;
  return {
    icao24: state.icao24,
    callsign: state.callsign?.trim() || null,
    originCountry: state.origin_country || null,
    latitude: state.latitude,
    longitude: state.longitude,
    altitudeM: state.baro_altitude ?? state.geo_altitude,
    velocityMs: state.velocity,
    heading: state.true_track,
    verticalRate: state.vertical_rate,
    squawk: state.squawk,
    onGround: state.on_ground,
    lastContact: state.last_contact,
  };
}

export async function fetchAirspace(params: {
  lat?: number;
  lon?: number;
  radiusMeters?: number;
  lamin?: number;
  lamax?: number;
  lomin?: number;
  lomax?: number;
}): Promise<{ aircraft: Aircraft[]; source: string }> {
  let { lamin, lamax, lomin, lomax } = params;

  if (
    lamin == null &&
    params.lat != null &&
    params.lon != null &&
    params.radiusMeters != null
  ) {
    const box = bboxFromCenter(params.lat, params.lon, params.radiusMeters);
    lamin = box.lamin;
    lamax = box.lamax;
    lomin = box.lomin;
    lomax = box.lomax;
  }

  // Prefer OpenSky (public)
  try {
    const qs = new URLSearchParams();
    if (lamin != null) qs.set("lamin", String(lamin));
    if (lamax != null) qs.set("lamax", String(lamax));
    if (lomin != null) qs.set("lomin", String(lomin));
    if (lomax != null) qs.set("lomax", String(lomax));

    const headers: HeadersInit = { Accept: "application/json" };
    const user = process.env.OPENSKY_USERNAME;
    const pass = process.env.OPENSKY_PASSWORD;
    if (user && pass) {
      headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
    }

    const res = await fetch(
      `https://opensky-network.org/api/states/all?${qs.toString()}`,
      { headers, next: { revalidate: 0 }, signal: AbortSignal.timeout(12_000) }
    );

    if (res.ok) {
      const data = (await res.json()) as {
        time: number;
        states: unknown[][] | null;
      };
      const aircraft: Aircraft[] = [];
      for (const row of data.states ?? []) {
        const mapped = mapOpenSky({
          icao24: String(row[0]),
          callsign: row[1] as string | null,
          origin_country: String(row[2] ?? ""),
          time_position: row[3] as number | null,
          last_contact: Number(row[4] ?? 0),
          longitude: row[5] as number | null,
          latitude: row[6] as number | null,
          baro_altitude: row[7] as number | null,
          on_ground: Boolean(row[8]),
          velocity: row[9] as number | null,
          true_track: row[10] as number | null,
          vertical_rate: row[11] as number | null,
          sensors: row[12] as number[] | null,
          geo_altitude: row[13] as number | null,
          squawk: row[14] as string | null,
          spi: Boolean(row[15]),
          position_source: Number(row[16] ?? 0),
        });
        if (mapped) aircraft.push(mapped);
      }
      return { aircraft, source: "opensky" };
    }
  } catch {
    // fall through
  }

  // Optional ADSB Exchange RapidAPI
  const rapidKey = process.env.ADSB_RAPIDAPI_KEY;
  if (rapidKey && params.lat != null && params.lon != null) {
    try {
      const dist = Math.max(
        1,
        Math.round((params.radiusMeters ?? 40233) / 1609.344)
      );
      const host =
        process.env.ADSB_RAPIDAPI_HOST || "adsbexchange-com1.p.rapidapi.com";
      const res = await fetch(
        `https://${host}/v2/lat/${params.lat}/lon/${params.lon}/dist/${dist}/`,
        {
          headers: {
            "x-rapidapi-key": rapidKey,
            "x-rapidapi-host": host,
          },
          signal: AbortSignal.timeout(12_000),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          ac?: Array<Record<string, unknown>>;
        };
        const aircraft: Aircraft[] = (data.ac ?? [])
          .filter((a) => typeof a.lat === "number" && typeof a.lon === "number")
          .map((a) => ({
            icao24: String(a.hex ?? a.icao ?? "unk"),
            callsign: a.flight ? String(a.flight).trim() : null,
            originCountry: null,
            latitude: Number(a.lat),
            longitude: Number(a.lon),
            altitudeM:
              typeof a.alt_baro === "number"
                ? Number(a.alt_baro) * 0.3048
                : typeof a.alt_geom === "number"
                  ? Number(a.alt_geom) * 0.3048
                  : null,
            velocityMs:
              typeof a.gs === "number" ? Number(a.gs) * 0.514444 : null,
            heading: typeof a.track === "number" ? Number(a.track) : null,
            verticalRate:
              typeof a.baro_rate === "number"
                ? Number(a.baro_rate) * 0.00508
                : null,
            squawk: a.squawk ? String(a.squawk) : null,
            onGround: Boolean(a.ground),
            lastContact: Math.floor(Date.now() / 1000),
          }));
        return { aircraft, source: "adsbexchange" };
      }
    } catch {
      // fall through
    }
  }

  const centerLat =
    params.lat ??
    ((((lamin ?? 0) + (lamax ?? 0)) / 2) || 40.7);
  const centerLon =
    params.lon ??
    ((((lomin ?? 0) + (lomax ?? 0)) / 2) || -74.0);
  return {
    aircraft: generateDemoAircraft(centerLat, centerLon),
    source: "demo",
  };
}

export function aircraftToGeoJSON(aircraft: Aircraft[]) {
  return {
    type: "FeatureCollection" as const,
    features: aircraft.map((a) => ({
      type: "Feature" as const,
      properties: {
        icao24: a.icao24,
        callsign: a.callsign,
        altitudeM: a.altitudeM,
        velocityMs: a.velocityMs,
        heading: a.heading,
        squawk: a.squawk,
        onGround: a.onGround,
        originCountry: a.originCountry,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [a.longitude, a.latitude, a.altitudeM ?? 0],
      },
    })),
  };
}
