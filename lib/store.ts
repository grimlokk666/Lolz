"use client";

import { create } from "zustand";
import type {
  Aircraft,
  AudioFeed,
  FlockCamera,
  GlobeClickPayload,
  LayerId,
  LayerState,
  RegionalInspection,
  WebcamAsset,
} from "@/types/master-eye";

export type LayerHealthStatus = "idle" | "live" | "degraded" | "error";

export interface LayerHealth {
  status: LayerHealthStatus;
  source: string;
  updatedAt: string | null;
  count: number;
}

interface MasterEyeState {
  layers: LayerState;
  layerHealth: Record<LayerId, LayerHealth>;
  inspectorOpen: boolean;
  inspection: RegionalInspection | null;
  inspectionLoading: boolean;
  inspectionError: string | null;
  selectedAircraftId: string | null;
  trackedAircraftId: string | null;
  flyToTarget: GlobeClickPayload | null;
  globalWebcams: WebcamAsset[];
  globalAudio: AudioFeed[];
  globalAircraft: Aircraft[];
  globalFlock: FlockCamera[];
  sectorRadiusMiles: number;
  statusMessage: string;
  clock: string;
  setLayer: (id: keyof LayerState, enabled: boolean) => void;
  toggleLayer: (id: keyof LayerState) => void;
  setLayerHealth: (
    id: LayerId,
    patch: Partial<LayerHealth> & Pick<LayerHealth, "status">
  ) => void;
  openInspection: (payload: GlobeClickPayload) => void;
  setInspection: (data: RegionalInspection | null) => void;
  setInspectionLoading: (loading: boolean) => void;
  setInspectionError: (error: string | null) => void;
  closeInspector: () => void;
  selectAircraft: (icao24: string | null) => void;
  trackAircraft: (icao24: string | null) => void;
  setFlyToTarget: (target: GlobeClickPayload | null) => void;
  setGlobalWebcams: (cams: WebcamAsset[]) => void;
  setGlobalAudio: (feeds: AudioFeed[]) => void;
  setGlobalAircraft: (aircraft: Aircraft[]) => void;
  setGlobalFlock: (cameras: FlockCamera[]) => void;
  setSectorRadiusMiles: (miles: number) => void;
  setStatusMessage: (msg: string) => void;
  tickClock: () => void;
}

const idleHealth = (): LayerHealth => ({
  status: "idle",
  source: "n/a",
  updatedAt: null,
  count: 0,
});

const defaultRadius = Number(
  process.env.NEXT_PUBLIC_DEFAULT_RADIUS_MILES ?? 25
);

export const useMasterEyeStore = create<MasterEyeState>((set) => ({
  layers: { aircraft: true, webcams: true, audio: true, flock: true },
  layerHealth: {
    aircraft: idleHealth(),
    webcams: idleHealth(),
    audio: idleHealth(),
    flock: idleHealth(),
  },
  inspectorOpen: false,
  inspection: null,
  inspectionLoading: false,
  inspectionError: null,
  selectedAircraftId: null,
  trackedAircraftId: null,
  flyToTarget: null,
  globalWebcams: [],
  globalAudio: [],
  globalAircraft: [],
  globalFlock: [],
  sectorRadiusMiles: Number.isFinite(defaultRadius) ? defaultRadius : 25,
  statusMessage: "SYSTEM ONLINE — AWAITING COORDINATE LOCK",
  clock: "",
  setLayer: (id, enabled) =>
    set((s) => ({ layers: { ...s.layers, [id]: enabled } })),
  toggleLayer: (id) =>
    set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),
  setLayerHealth: (id, patch) =>
    set((s) => ({
      layerHealth: {
        ...s.layerHealth,
        [id]: { ...s.layerHealth[id], ...patch },
      },
    })),
  openInspection: (payload) =>
    set({
      inspectorOpen: true,
      flyToTarget: payload,
      inspectionError: null,
      statusMessage: `SECTOR LOCK // ${payload.latitude.toFixed(4)}, ${payload.longitude.toFixed(4)}`,
    }),
  setInspection: (data) => set({ inspection: data, inspectionLoading: false }),
  setInspectionLoading: (loading) => set({ inspectionLoading: loading }),
  setInspectionError: (error) =>
    set({ inspectionError: error, inspectionLoading: false }),
  closeInspector: () =>
    set({
      inspectorOpen: false,
      trackedAircraftId: null,
      statusMessage: "INSPECTOR CLOSED — RESUME GLOBAL OVERWATCH",
    }),
  selectAircraft: (icao24) => set({ selectedAircraftId: icao24 }),
  trackAircraft: (icao24) =>
    set({
      trackedAircraftId: icao24,
      selectedAircraftId: icao24,
      statusMessage: icao24
        ? `TRACKING TARGET // ${icao24.toUpperCase()}`
        : "TRACK RELEASED",
    }),
  setFlyToTarget: (target) => set({ flyToTarget: target }),
  setGlobalWebcams: (cams) => set({ globalWebcams: cams }),
  setGlobalAudio: (feeds) => set({ globalAudio: feeds }),
  setGlobalAircraft: (aircraft) => set({ globalAircraft: aircraft }),
  setGlobalFlock: (cameras) => set({ globalFlock: cameras }),
  setSectorRadiusMiles: (miles) => set({ sectorRadiusMiles: miles }),
  setStatusMessage: (msg) => set({ statusMessage: msg }),
  tickClock: () => set({ clock: new Date().toISOString() }),
}));

if (typeof window !== "undefined") {
  useMasterEyeStore.setState({ clock: new Date().toISOString() });
}
