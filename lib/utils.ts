import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function milesToMeters(miles: number): number {
  return miles * 1609.344;
}

export function metersToMiles(meters: number): number {
  return meters / 1609.344;
}

export function formatCoord(value: number, digits = 4): string {
  return value.toFixed(digits);
}

export function formatAltitudeFt(meters: number | null | undefined): string {
  if (meters == null || Number.isNaN(meters)) return "—";
  return `${Math.round(meters * 3.28084).toLocaleString()} ft`;
}

export function formatSpeedKt(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  return `${Math.round(ms * 1.94384)} kt`;
}

export function formatHeading(deg: number | null | undefined): string {
  if (deg == null || Number.isNaN(deg)) return "—";
  return `${Math.round(deg).toString().padStart(3, "0")}°`;
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Clamp helpers for API / operator input. */
export function clampLat(lat: number): number {
  return Math.max(-90, Math.min(90, lat));
}

export function clampLon(lon: number): number {
  if (!Number.isFinite(lon)) return 0;
  let x = lon;
  while (x < -180) x += 360;
  while (x > 180) x -= 360;
  return x;
}

export function clampRadiusMiles(miles: number, min = 1, max = 250): number {
  if (!Number.isFinite(miles)) return min;
  return Math.max(min, Math.min(max, miles));
}

export function isEmergencySquawk(squawk: string | null | undefined): boolean {
  return squawk === "7700" || squawk === "7600" || squawk === "7500";
}

/**
 * Pole-safe bbox. Near ±90° cos(lat)→0; clamp longitude span to the full globe
 * so OpenSky / Overpass queries never receive NaN/Infinity.
 */
export function bboxFromCenter(
  lat: number,
  lon: number,
  radiusMeters: number
): { lamin: number; lamax: number; lomin: number; lomax: number } {
  const safeLat = clampLat(lat);
  const safeLon = clampLon(lon);
  const dLat = radiusMeters / 111320;
  const cosLat = Math.cos((safeLat * Math.PI) / 180);
  const dLon =
    Math.abs(cosLat) < 1e-6
      ? 180
      : radiusMeters / (111320 * Math.abs(cosLat));

  return {
    lamin: clampLat(safeLat - dLat),
    lamax: clampLat(safeLat + dLat),
    lomin: Math.max(-180, safeLon - dLon),
    lomax: Math.min(180, safeLon + dLon),
  };
}
