"use client";

import { create } from "zustand";
import type {
  Aircraft,
  AudioFeed,
  GlobeClickPayload,
  LayerState,
  RegionalInspection,
  WebcamAsset,
} from "@/types/master-eye";

interface MasterEyeState {
  layers: LayerState;
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
  statusMessage: string;
  clock: string;
  setLayer: (id: keyof LayerState, enabled: boolean) => void;
  toggleLayer: (id: keyof LayerState) => void;
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
  setStatusMessage: (msg: string) => void;
  tickClock: () => void;
}

export const useMasterEyeStore = create<MasterEyeState>((set) => ({
  layers: { aircraft: true, webcams: true, audio: true },
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
  statusMessage: "SYSTEM ONLINE — AWAITING COORDINATE LOCK",
  clock: "",
  setLayer: (id, enabled) =>
    set((s) => ({ layers: { ...s.layers, [id]: enabled } })),
  toggleLayer: (id) =>
    set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),
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
  setStatusMessage: (msg) => set({ statusMessage: msg }),
  tickClock: () => set({ clock: new Date().toISOString() }),
}));

// Avoid SSR/client mismatch: seed clock only on client
if (typeof window !== "undefined") {
  useMasterEyeStore.setState({ clock: new Date().toISOString() });
}