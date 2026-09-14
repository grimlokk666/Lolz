"use client";

import React, { useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import ErrorBoundary from "@/components/ErrorBoundary";
import HudToolbar from "@/components/HudToolbar";
import RegionalInspector from "@/components/RegionalInspector";
import { useMasterEyeStore } from "@/lib/store";
import { mergeFlockCameras } from "@/lib/flock";
import type { RegionalInspection } from "@/types/master-eye";
import { milesToMeters } from "@/lib/utils";

const GlobeView = dynamic(() => import("@/components/GlobeView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#030712] font-mono text-xs uppercase tracking-[0.35em] text-cyan-400 animate-pulse">
      Bootstrapping Cesium runtime…
    </div>
  ),
});

const DEFAULT_RADIUS = Number(
  process.env.NEXT_PUBLIC_DEFAULT_RADIUS_MILES ?? 25
);

export default function CommandCenter() {
  const openInspection = useMasterEyeStore((s) => s.openInspection);
  const setInspection = useMasterEyeStore((s) => s.setInspection);
  const setInspectionLoading = useMasterEyeStore((s) => s.setInspectionLoading);
  const setInspectionError = useMasterEyeStore((s) => s.setInspectionError);
  const setGlobalWebcams = useMasterEyeStore((s) => s.setGlobalWebcams);
  const setGlobalAudio = useMasterEyeStore((s) => s.setGlobalAudio);
  const setGlobalAircraft = useMasterEyeStore((s) => s.setGlobalAircraft);
  const setGlobalFlock = useMasterEyeStore((s) => s.setGlobalFlock);
  const setStatusMessage = useMasterEyeStore((s) => s.setStatusMessage);
  const tickClock = useMasterEyeStore((s) => s.tickClock);
  const trackAircraft = useMasterEyeStore((s) => s.trackAircraft);

  const globalWebcams = useMasterEyeStore((s) => s.globalWebcams);
  const globalAudio = useMasterEyeStore((s) => s.globalAudio);
  const globalAircraft = useMasterEyeStore((s) => s.globalAircraft);
  const globalFlock = useMasterEyeStore((s) => s.globalFlock);

  const inspectAbortRef = useRef<AbortController | null>(null);
  const userInspectedRef = useRef(false);
  const bootInspectFiredRef = useRef(false);

  useEffect(() => {
    const clockId = window.setInterval(tickClock, 1000);
    return () => window.clearInterval(clockId);
  }, [tickClock]);

  useEffect(() => {
    let cancelled = false;

    async function loadLayers() {
      try {
        const [camsRes, audioRes, airRes, flockRes] = await Promise.all([
          fetch("/api/webcams"),
          fetch("/api/audio-feeds"),
          fetch(`/api/airspace?lamin=24&lamax=50&lomin=-125&lomax=-66`),
          fetch("/api/flock"),
        ]);

        const parseJson = async (res: Response, label: string) => {
          const text = await res.text();
          if (!res.ok) {
            throw new Error(`${label} HTTP ${res.status}`);
          }
          try {
            return JSON.parse(text);
          } catch {
            throw new Error(`${label} returned non-JSON`);
          }
        };

        const cams = await parseJson(camsRes, "webcams");
        const audio = await parseJson(audioRes, "audio");
        const air = await parseJson(airRes, "airspace");
        const flock = await parseJson(flockRes, "flock");

        if (cancelled) return;
        setGlobalWebcams(cams.webcams ?? []);
        setGlobalAudio(audio.feeds ?? []);
        setGlobalAircraft(air.aircraft ?? []);
        setGlobalFlock(
          mergeFlockCameras(
            useMasterEyeStore.getState().globalFlock,
            flock.cameras ?? []
          )
        );
        setStatusMessage(
          `OVERWATCH READY // ${cams.count ?? 0} CAMS · ${audio.count ?? 0} AUDIO · ${air.count ?? 0} ACFT · ${flock.count ?? 0} FLOCK (${flock.source ?? "n/a"})`
        );
      } catch (err) {
        if (!cancelled) {
          setStatusMessage(
            `LAYER SYNC DEGRADED // ${err instanceof Error ? err.message : "network"}`
          );
        }
      }
    }

    loadLayers();
    const pollId = window.setInterval(loadLayers, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [
    setGlobalAircraft,
    setGlobalAudio,
    setGlobalFlock,
    setGlobalWebcams,
    setStatusMessage,
  ]);

  const runInspection = useCallback(
    async (
      lat: number,
      lon: number,
      meta?: {
        entityId?: string;
        entityType?: "aircraft" | "webcam" | "audio" | "flock";
        fromUser?: boolean;
      }
    ) => {
      if (meta?.fromUser) {
        userInspectedRef.current = true;
      }

      inspectAbortRef.current?.abort();
      const ac = new AbortController();
      inspectAbortRef.current = ac;

      openInspection({
        latitude: lat,
        longitude: lon,
        entityId: meta?.entityId,
        entityType: meta?.entityType,
      });
      setInspectionLoading(true);
      setInspectionError(null);

      if (meta?.entityType === "aircraft" && meta.entityId) {
        trackAircraft(meta.entityId);
      }

      try {
        const res = await fetch(
          `/api/region?lat=${lat}&lon=${lon}&radiusMiles=${DEFAULT_RADIUS}`,
          { signal: ac.signal }
        );
        const data = await res.json();
        if (ac.signal.aborted) return;
        if (!res.ok) {
          throw new Error(data.error || "Regional inspection failed");
        }
        const inspection: RegionalInspection = {
          latitude: data.latitude,
          longitude: data.longitude,
          radiusMiles: data.radiusMiles,
          radiusMeters: data.radiusMeters ?? milesToMeters(data.radiusMiles),
          webcams: data.webcams ?? [],
          audioFeeds: data.audioFeeds ?? [],
          aircraft: data.aircraft ?? [],
          flockCameras: data.flockCameras ?? [],
          queriedAt: data.queriedAt,
        };
        setInspection(inspection);

        // Enrich globe Flock layer — never replace the global catalog with a sector slice.
        if (inspection.flockCameras.length > 0) {
          setGlobalFlock(
            mergeFlockCameras(
              useMasterEyeStore.getState().globalFlock,
              inspection.flockCameras
            )
          );
        }

        const flockSrc = data.sources?.flock ?? "n/a";
        setStatusMessage(
          `SECTOR RESOLVED // ${inspection.webcams.length} CAM · ${inspection.aircraft.length} ACFT · ${inspection.audioFeeds.length} AUDIO · ${inspection.flockCameras.length} FLOCK (${flockSrc})`
        );
      } catch (err) {
        if (ac.signal.aborted) return;
        setInspectionError(
          err instanceof Error ? err.message : "Inspection failed"
        );
      }
    },
    [
      openInspection,
      setGlobalFlock,
      setInspection,
      setInspectionError,
      setInspectionLoading,
      setStatusMessage,
      trackAircraft,
    ]
  );

  const handleInspect = useCallback(
    (
      lat: number,
      lon: number,
      meta?: {
        entityId?: string;
        entityType?: "aircraft" | "webcam" | "audio" | "flock";
      }
    ) => {
      void runInspection(lat, lon, { ...meta, fromUser: true });
    },
    [runInspection]
  );

  // Soft demo focus: NYC once, skipped if the operator already clicked the globe.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (bootInspectFiredRef.current || userInspectedRef.current) return;
      bootInspectFiredRef.current = true;
      void runInspection(40.7128, -74.006);
    }, 2800);
    return () => {
      window.clearTimeout(t);
      inspectAbortRef.current?.abort();
    };
  }, [runInspection]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#030712]">
      <div className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(3,7,18,0.65)_100%)]" />
      <div className="pointer-events-none absolute inset-0 z-20 opacity-[0.07] mix-blend-overlay [background-image:repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(34,211,238,0.15)_3px)]" />

      <ErrorBoundary fallbackTitle="Globe Rendering Fault">
        <GlobeView
          webcams={globalWebcams}
          audioFeeds={globalAudio}
          aircraft={globalAircraft}
          flockCameras={globalFlock}
          onInspect={handleInspect}
        />
      </ErrorBoundary>

      <HudToolbar />

      <ErrorBoundary fallbackTitle="Inspector Fault">
        <RegionalInspector />
      </ErrorBoundary>
    </main>
  );
}
