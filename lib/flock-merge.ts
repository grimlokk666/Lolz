import type { FlockCamera } from "@/types/master-eye";

/**
 * Client-safe flock catalog merge (no Overpass / Node fetch).
 * Prefer osmId when present so Overpass + PostGIS rows collapse to one marker.
 */
export function mergeFlockCameras(
  base: FlockCamera[],
  incoming: FlockCamera[],
  maxEntries = 2500
): FlockCamera[] {
  const byKey = new Map<string, FlockCamera>();

  const keyOf = (cam: FlockCamera) => cam.osmId ?? cam.id;

  for (const cam of base) byKey.set(keyOf(cam), cam);
  for (const cam of incoming) {
    const key = keyOf(cam);
    const prev = byKey.get(key);
    byKey.set(key, prev ? { ...prev, ...cam, id: prev.id || cam.id } : cam);
  }

  const merged = Array.from(byKey.values());
  if (merged.length <= maxEntries) return merged;

  return merged
    .sort((a, b) => (a.distanceM ?? 1e12) - (b.distanceM ?? 1e12))
    .slice(0, maxEntries);
}
