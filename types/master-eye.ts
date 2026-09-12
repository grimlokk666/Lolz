export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface WebcamAsset {
  id: string;
  ip: string;
  port: number;
  product: string | null;
  title: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  snapshotUrl: string | null;
  streamUrl: string | null;
  protocol: string;
  tags: string[];
  distanceM?: number;
  isActive: boolean;
}

export interface AudioFeed {
  id: string;
  name: string;
  feedType: "aviation" | "emergency" | "police" | "fire" | "marine" | "other";
  description: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  streamUrl: string;
  websiteUrl: string | null;
  frequency: string | null;
  distanceM?: number;
  isActive: boolean;
}

export interface Aircraft {
  icao24: string;
  callsign: string | null;
  originCountry: string | null;
  latitude: number;
  longitude: number;
  altitudeM: number | null;
  velocityMs: number | null;
  heading: number | null;
  verticalRate: number | null;
  squawk: string | null;
  onGround: boolean;
  lastContact: number | null;
}

export interface RegionalInspection {
  latitude: number;
  longitude: number;
  radiusMiles: number;
  radiusMeters: number;
  webcams: WebcamAsset[];
  audioFeeds: AudioFeed[];
  aircraft: Aircraft[];
  queriedAt: string;
}

export type LayerId = "aircraft" | "webcams" | "audio";

export interface LayerState {
  aircraft: boolean;
  webcams: boolean;
  audio: boolean;
}

export interface GlobeClickPayload {
  latitude: number;
  longitude: number;
  entityId?: string;
  entityType?: "aircraft" | "webcam" | "audio";
}
