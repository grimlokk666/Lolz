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

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

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

function buildOverpassQuery(bbox: {
  south: number;
  west: number;
  north: number;
  east: number;
}): string {
  const { south, west, north, east } = bbox;
  // Community ALPR tags used by DeFlock / Finding Flock / OSM mappers
  return `
[out:json][timeout:25];
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
  const manufacturer =
    tags.manufacturer ||
    tags.brand ||
    (tags["manufacturer:wikidata"] ? "Flock Safety" : null);
  const isFlock =
    /flock/i.test(manufacturer ?? "") ||
    /flock/i.test(tags.operator ?? "") ||
    /flock/i.test(tags.name ?? "");

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
    manufacturer: manufacturer || (isFlock ? "Flock Safety" : "Unknown ALPR"),
    model: tags.model || tags["camera:model"] || null,
    operator: tags.operator || tags.owner || null,
    city: tags["addr:city"] || null,
    state: tags["addr:state"] || null,
    country: tags["addr:country"] || "United States",
    countryCode: tags["addr:country"]?.length === 2 ? tags["addr:country"] : "US",
    latitude: el.lat,
    longitude: el.lon,
    direction: tags.direction ? Number.parseFloat(tags.direction) : null,
    surveillanceType:
      tags["surveillance:type"]?.toUpperCase() ||
      tags["camera:type"]?.toUpperCase() ||
      "ALPR",
    source: "overpass",
    tags: Array.from(new Set(tagList)),
    isActive: true,
  };
}

export async function fetchFlockFromOverpass(params: {
  lat: number;
  lon: number;
  radiusMeters: number;
}): Promise<{ cameras: FlockCamera[]; source: string }> {
  const bbox = bboxFromCenter(params.lat, params.lon, params.radiusMeters);
  const query = buildOverpassQuery(bbox);
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
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });

      if (!res.ok) {
        lastError = new Error(`Overpass ${res.status}`);
        continue;
      }

      const data = (await res.json()) as OverpassResponse;
      const cameras = (data.elements ?? [])
        .map(mapOverpassElement)
        .filter((c): c is FlockCamera => c != null)
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

      return { cameras, source: "overpass" };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Overpass ALPR query failed");
}

export async function fetchFlockBboxFromOverpass(params: {
  south: number;
  west: number;
  north: number;
  east: number;
}): Promise<{ cameras: FlockCamera[]; source: string }> {
  const query = buildOverpassQuery(params);
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
        signal: AbortSignal.timeout(25_000),
        cache: "no-store",
      });
      if (!res.ok) continue;
      const data = (await res.json()) as OverpassResponse;
      const cameras = (data.elements ?? [])
        .map(mapOverpassElement)
        .filter((c): c is FlockCamera => c != null);
      return { cameras, source: "overpass" };
    } catch {
      // try next endpoint
    }
  }
  return { cameras: [], source: "overpass-empty" };
}
