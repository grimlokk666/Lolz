"use client";

import React, { useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import ErrorBoundary from "@/components/ErrorBoundary";
import HudToolbar from "@/components/HudToolbar";
import RegionalInspector from "@/components/RegionalInspector";
import { useMasterEyeStore } from "@/lib/store";
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
  const setStatusMessage = useMasterEyeStore((s) => s.setStatusMessage);
  const tickClock = useMasterEyeStore((s) => s.tickClock);
  const trackAircraft = useMasterEyeStore((s) => s.trackAircraft);

  const globalWebcams = useMasterEyeStore((s) => s.globalWebcams);
  const globalAudio = useMasterEyeStore((s) => s.globalAudio);
  const globalAircraft = useMasterEyeStore((s) => s.globalAircraft);

  // Clock + global layer bootstrap
  useEffect(() => {
    const clockId = window.setInterval(tickClock, 1000);
    return () => window.clearInterval(clockId);
  }, [tickClock]);

  useEffect(() => {
    let cancelled = false;

    async function loadLayers() {
      try {
        const [camsRes, audioRes, airRes] = await Promise.all([
          fetch("/api/webcams"),
          fetch("/api/audio-feeds"),
          fetch(
            `/api/airspace?lamin=24&lamax=50&lomin=-125&lomax=-66`
          ),
        ]);

        const cams = await camsRes.json();
        const audio = await audioRes.json();
        const air = await airRes.json();

        if (cancelled) return;
        setGlobalWebcams(cams.webcams ?? []);
        setGlobalAudio(audio.feeds ?? []);
        setGlobalAircraft(air.aircraft ?? []);
        setStatusMessage(
          `OVERWATCH READY // ${cams.count ?? 0} CAMS · ${audio.count ?? 0} AUDIO · ${air.count ?? 0} ACFT (${air.source ?? "n/a"})`
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
    setGlobalWebcams,
    setStatusMessage,
  ]);

  const runInspection = useCallback(
    async (
      lat: number,
      lon: number,
      meta?: { entityId?: string; entityType?: "aircraft" | "webcam" | "audio" }
    ) => {
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
          `/api/region?lat=${lat}&lon=${lon}&radiusMiles=${DEFAULT_RADIUS}`
        );
        const data = await res.json();
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
          queriedAt: data.queriedAt,
        };
        setInspection(inspection);
        setGlobalAircraft(data.aircraft ?? []);
        setStatusMessage(
          `SECTOR RESOLVED // ${inspection.webcams.length} CAM · ${inspection.aircraft.length} ACFT · ${inspection.audioFeeds.length} AUDIO`
        );
      } catch (err) {
        setInspectionError(
          err instanceof Error ? err.message : "Inspection failed"
        );
      }
    },
    [
      openInspection,
      setGlobalAircraft,
      setInspection,
      setInspectionError,
      setInspectionLoading,
      setStatusMessage,
      trackAircraft,
    ]
  );

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#030712]">
      {/* Atmospheric vignette */}
      <div className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(3,7,18,0.65)_100%)]" />
      <div className="pointer-events-none absolute inset-0 z-20 opacity-[0.07] mix-blend-overlay [background-image:repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(34,211,238,0.15)_3px)]" />

      <ErrorBoundary fallbackTitle="Globe Rendering Fault">
        <GlobeView
          webcams={globalWebcams}
          audioFeeds={globalAudio}
          aircraft={globalAircraft}
          onInspect={runInspection}
        />
      </ErrorBoundary>

      <HudToolbar />

      <ErrorBoundary fallbackTitle="Inspector Fault">
        <RegionalInspector />
      </ErrorBoundary>
    </main>
  );
}
