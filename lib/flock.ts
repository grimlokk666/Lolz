import type { FlockCamera } from "@/types/master-eye";
import { haversineMeters } from "@/lib/utils";

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

interface CacheEntry {
  at: number;
  cameras: FlockCamera[];
  source: string;
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const CACHE_TTL_MS = 5 * 60_000;
const overpassCache = new Map<string, CacheEntry>();

const CARDINAL_HDG: Record<string, number> = {
  n: 0,
  north: 0,
  ne: 45,
  northeast: 45,
  e: 90,
  east: 90,
  se: 135,
  southeast: 135,
  s: 180,
  south: 180,
  sw: 225,
  southwest: 225,
  w: 270,
  west: 270,
  nw: 315,
  northwest: 315,
};

function bboxFromCenter(
  lat: number,
  lon: number,
  radiusMeters: number
): { south: number; west: number; north: number; east: number } {
  const dLat = radiusMeters / 111_320;
  const dLon = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    south: lat - dLat,
    north: lat + dLat,
    west: lon - dLon,
    east: lon + dLon,
  };
}

function cacheKey(
  lat: number,
  lon: number,
  radiusMeters: number
): string {
  return `${lat.toFixed(2)}:${lon.toFixed(2)}:${Math.round(radiusMeters / 500)}`;
}

function readCache(key: string): CacheEntry | null {
  const hit = overpassCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    overpassCache.delete(key);
    return null;
  }
  return hit;
}

function writeCache(key: string, cameras: FlockCamera[], source: string) {
  overpassCache.set(key, { at: Date.now(), cameras, source });
}

/** Parse OSM direction tags: degrees, cardinals, or "facing south". */
export function parseDirection(raw?: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const trimmed = raw.trim();
  const numeric = Number.parseFloat(trimmed);
  if (Number.isFinite(numeric)) {
    return ((numeric % 360) + 360) % 360;
  }
  const normalized = trimmed
    .toLowerCase()
    .replace(/^facing\s+/, "")
    .replace(/[^a-z]/g, "");
  return CARDINAL_HDG[normalized] ?? null;
}

function looksLikeFlock(tags: Record<string, string>, manufacturer: string | null) {
  const haystack = [
    manufacturer,
    tags.operator,
    tags.owner,
    tags.name,
    tags.brand,
    tags.manufacturer,
  ]
    .filter(Boolean)
    .join(" ");
  return /flock/i.test(haystack);
}

function buildOverpassQuery(bbox: {
  south: number;
  west: number;
  north: number;
  east: number;
}): string {
  const { south, west, north, east } = bbox;
  // Community ALPR tags used by DeFlock / Finding Flock / OSM mappers
  return `
[out:json][timeout:12];
(
  node["surveillance:type"="ALPR"](${south},${west},${north},${east});
  node["surveillance:type"="anpr"](${south},${west},${north},${east});
  node["manufacturer"="Flock Safety"](${south},${west},${north},${east});
  node["manufacturer"="Flock"](${south},${west},${north},${east});
  node["brand"="Flock Safety"](${south},${west},${north},${east});
);
out body;
`.trim();
}

function mapOverpassElement(el: OverpassElement): FlockCamera | null {
  if (el.lat == null || el.lon == null) return null;
  const tags = el.tags ?? {};
  // Never infer "Flock Safety" from wikidata alone — many ALPR brands share generic Q-ids.
  const manufacturerRaw = tags.manufacturer || tags.brand || null;
  const isFlock = looksLikeFlock(tags, manufacturerRaw);
  const manufacturer =
    manufacturerRaw || (isFlock ? "Flock Safety" : "ALPR Node");

  const tagList = Object.entries(tags)
    .filter(([k]) =>
      ["surveillance:type", "camera:type", "direction", "operator", "model"].includes(
        k
      )
    )
    .map(([k, v]) => `${k}=${v}`);

  if (isFlock) tagList.unshift("flock");
  tagList.unshift("alpr");

  return {
    id: `osm-${el.type}-${el.id}`,
    osmId: String(el.id),
    name: tags.name || tags.ref || null,
    manufacturer,
    model: tags.model || tags["camera:model"] || null,
    operator: tags.operator || tags.owner || null,
    city: tags["addr:city"] || null,
    state: tags["addr:state"] || null,
    country: tags["addr:country"] || "United States",
    countryCode: tags["addr:country"]?.length === 2 ? tags["addr:country"] : "US",
    latitude: el.lat,
    longitude: el.lon,
    direction: parseDirection(tags.direction),
    surveillanceType:
      tags["surveillance:type"]?.toUpperCase() ||
      tags["camera:type"]?.toUpperCase() ||
      "ALPR",
    source: "overpass",
    tags: Array.from(new Set(tagList)),
    isActive: true,
  };
}

async function postOverpass(
  query: string,
  timeoutMs: number
): Promise<{ cameras: FlockCamera[]; source: string }> {
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Accept: "application/json",
          "User-Agent": "MASTER-EYE/1.0 (tactical-isr; educational-osint)",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });

      if (!res.ok) {
        lastError = new Error(`Overpass ${res.status}`);
        continue;
      }

      const data = (await res.json()) as OverpassResponse;
      const cameras = (data.elements ?? [])
        .map(mapOverpassElement)
        .filter((c): c is FlockCamera => c != null);

      return {
        cameras,
        source: cameras.length > 0 ? "overpass" : "overpass-empty",
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Overpass ALPR query failed");
}

export async function fetchFlockFromOverpass(params: {
  lat: number;
  lon: number;
  radiusMeters: number;
}): Promise<{ cameras: FlockCamera[]; source: string }> {
  const key = cacheKey(params.lat, params.lon, params.radiusMeters);
  const cached = readCache(key);
  if (cached) {
    return {
      cameras: cached.cameras.map((c) => ({
        ...c,
        distanceM: haversineMeters(
          params.lat,
          params.lon,
          c.latitude,
          c.longitude
        ),
      })),
      source: `${cached.source}+cache`,
    };
  }

  const bbox = bboxFromCenter(params.lat, params.lon, params.radiusMeters);
  const query = buildOverpassQuery(bbox);
  const result = await postOverpass(query, 8_000);

  const cameras = result.cameras
    .map((c) => ({
      ...c,
      distanceM: haversineMeters(
        params.lat,
        params.lon,
        c.latitude,
        c.longitude
      ),
    }))
    .filter((c) => (c.distanceM ?? 0) <= params.radiusMeters)
    .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));

  writeCache(key, cameras, result.source);
  return { cameras, source: result.source };
}

export async function fetchFlockBboxFromOverpass(params: {
  south: number;
  west: number;
  north: number;
  east: number;
}): Promise<{ cameras: FlockCamera[]; source: string }> {
  const key = `bbox:${params.south.toFixed(1)}:${params.west.toFixed(1)}:${params.north.toFixed(1)}:${params.east.toFixed(1)}`;
  const cached = readCache(key);
  if (cached) {
    return { cameras: cached.cameras, source: `${cached.source}+cache` };
  }

  const query = buildOverpassQuery(params);
  try {
    const result = await postOverpass(query, 12_000);
    writeCache(key, result.cameras, result.source);
    return result;
  } catch {
    return { cameras: [], source: "overpass-empty" };
  }
}

/** Merge catalogs by id without dropping existing globe coverage. */
export function mergeFlockCameras(
  base: FlockCamera[],
  incoming: FlockCamera[]
): FlockCamera[] {
  const byId = new Map<string, FlockCamera>();
  for (const cam of base) byId.set(cam.id, cam);
  for (const cam of incoming) {
    const prev = byId.get(cam.id);
    byId.set(cam.id, prev ? { ...prev, ...cam } : cam);
  }
  return Array.from(byId.values());
}
