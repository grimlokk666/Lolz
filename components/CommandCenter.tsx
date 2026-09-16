"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ErrorBoundary from "@/components/ErrorBoundary";
import HudToolbar from "@/components/HudToolbar";
import RegionalInspector from "@/components/RegionalInspector";
import { useMasterEyeStore } from "@/lib/store";
import { mergeFlockCameras } from "@/lib/flock";
import type { Aircraft, RegionalInspection } from "@/types/master-eye";
import {
  clampRadiusMiles,
  isEmergencySquawk,
  milesToMeters,
} from "@/lib/utils";

const GlobeView = dynamic(() => import("@/components/GlobeView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#030712] font-mono text-xs uppercase tracking-[0.35em] text-cyan-400 animate-pulse">
      Bootstrapping Cesium runtime…
    </div>
  ),
});

function mapTelemetryAircraft(raw: Record<string, unknown>): Aircraft | null {
  const lat = Number(raw.latitude);
  const lon = Number(raw.longitude);
  const icao24 = String(raw.icao24 ?? "");
  if (!icao24 || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const altitudeM =
    raw.altitudeM != null
      ? Number(raw.altitudeM)
      : raw.altitudeM != null
        ? Number(raw.altitudeM)
        : NaN;
  const velocityMs =
    raw.velocityMs != null
      ? Number(raw.velocityMs)
      : raw.velocityMs != null
        ? Number(raw.velocityMs)
        : NaN;

  return {
    icao24,
    callsign: raw.callsign != null ? String(raw.callsign) : null,
    originCountry:
      raw.originCountry != null ? String(raw.originCountry) : null,
    latitude: lat,
    longitude: lon,
    altitudeM: Number.isFinite(altitudeM) ? altitudeM : null,
    velocityMs: Number.isFinite(velocityMs) ? velocityMs : null,
    heading: raw.heading != null ? Number(raw.heading) : null,
    verticalRate:
      raw.verticalRate != null ? Number(raw.verticalRate) : null,
    squawk: raw.squawk != null ? String(raw.squawk) : null,
    onGround: Boolean(raw.onGround),
    lastContact: raw.lastContact != null ? Number(raw.lastContact) : null,
  };
}

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
  const setLayerHealth = useMasterEyeStore((s) => s.setLayerHealth);
  const tickClock = useMasterEyeStore((s) => s.tickClock);
  const trackAircraft = useMasterEyeStore((s) => s.trackAircraft);
  const sectorRadiusMiles = useMasterEyeStore((s) => s.sectorRadiusMiles);

  const globalWebcams = useMasterEyeStore((s) => s.globalWebcams);
  const globalAudio = useMasterEyeStore((s) => s.globalAudio);
  const globalAircraft = useMasterEyeStore((s) => s.globalAircraft);
  const globalFlock = useMasterEyeStore((s) => s.globalFlock);

  const inspectAbortRef = useRef<AbortController | null>(null);
  const userInspectedRef = useRef(false);
  const bootInspectFiredRef = useRef(false);
  const telemetryLiveRef = useRef(false);
  const lastRadiusRef = useRef(sectorRadiusMiles);
  const [globeEpoch, setGlobeEpoch] = useState(0);

  useEffect(() => {
    const id = window.setInterval(tickClock, 1000);
    return () => window.clearInterval(id);
  }, [tickClock]);

  useEffect(() => {
    let cancelled = false;

    async function loadLayers() {
      const endpoints = [
        { key: "webcams" as const, url: "/api/webcams" },
        { key: "audio" as const, url: "/api/audio-feeds" },
        {
          key: "aircraft" as const,
          // Credit-friendly NE corridor (~1 OpenSky credit). Full CONUS costs 4.
          url: "/api/airspace?lamin=38&lamax=43&lomin=-80&lomax=-71",
        },
        { key: "flock" as const, url: "/api/flock" },
      ];

      const results = await Promise.allSettled(
        endpoints.map(async (ep) => {
          const res = await fetch(ep.url);
          const text = await res.text();
          if (!res.ok) throw new Error(`${ep.key} HTTP ${res.status}`);
          try {
            return {
              key: ep.key,
              data: JSON.parse(text) as Record<string, unknown>,
            };
          } catch {
            throw new Error(`${ep.key} returned non-JSON`);
          }
        })
      );

      if (cancelled) return;
      const now = new Date().toISOString();
      const counts: Record<string, number> = {};
      let failures = 0;

      for (const result of results) {
        if (result.status === "rejected") {
          failures += 1;
          const msg =
            result.reason instanceof Error
              ? result.reason.message
              : "layer sync failed";
          const key = msg.split(" ")[0];
          if (
            key === "webcams" ||
            key === "audio" ||
            key === "aircraft" ||
            key === "flock"
          ) {
            const state = useMasterEyeStore.getState();
            const count =
              key === "webcams"
                ? state.globalWebcams.length
                : key === "audio"
                  ? state.globalAudio.length
                  : key === "aircraft"
                    ? state.globalAircraft.length
                    : state.globalFlock.length;
            setLayerHealth(key, {
              status: "error",
              source: "error",
              updatedAt: now,
              count,
            });
          }
          continue;
        }

        const { key, data } = result.value;
        if (key === "webcams") {
          const cams = (data.webcams as typeof globalWebcams) ?? [];
          setGlobalWebcams(cams);
          counts.webcams = cams.length;
          setLayerHealth("webcams", {
            status: "live",
            source: String(data.source ?? "api"),
            updatedAt: now,
            count: cams.length,
          });
        } else if (key === "audio") {
          const feeds = (data.feeds as typeof globalAudio) ?? [];
          setGlobalAudio(feeds);
          counts.audio = feeds.length;
          setLayerHealth("audio", {
            status: "live",
            source: String(data.source ?? "api"),
            updatedAt: now,
            count: feeds.length,
          });
        } else if (key === "aircraft") {
          if (!telemetryLiveRef.current) {
            const aircraft = (data.aircraft as Aircraft[]) ?? [];
            setGlobalAircraft(aircraft);
            counts.aircraft = aircraft.length;
            const source = String(data.source ?? "api");
            setLayerHealth("aircraft", {
              status: source.includes("demo") ? "degraded" : "live",
              source,
              updatedAt: now,
              count: aircraft.length,
            });
          } else {
            counts.aircraft =
              useMasterEyeStore.getState().globalAircraft.length;
          }
        } else if (key === "flock") {
          const cameras = (data.cameras as typeof globalFlock) ?? [];
          setGlobalFlock(
            mergeFlockCameras(
              useMasterEyeStore.getState().globalFlock,
              cameras
            )
          );
          counts.flock = useMasterEyeStore.getState().globalFlock.length;
          setLayerHealth("flock", {
            status: "live",
            source: String(data.source ?? "api"),
            updatedAt: now,
            count: counts.flock,
          });
        }
      }

      const emergency = useMasterEyeStore
        .getState()
        .globalAircraft.filter((a) => isEmergencySquawk(a.squawk)).length;

      setStatusMessage(
        failures > 0
          ? `LAYER SYNC PARTIAL // ${failures} FAULT(S) · CAM ${counts.webcams ?? 0} · AUD ${counts.audio ?? 0} · ACFT ${counts.aircraft ?? 0} · FLOCK ${counts.flock ?? 0}`
          : `OVERWATCH READY // ${counts.webcams ?? 0} CAM · ${counts.audio ?? 0} AUD · ${counts.aircraft ?? 0} ACFT · ${counts.flock ?? 0} FLOCK${emergency ? ` · ${emergency} EMERG SQK` : ""}`
      );
    }

    void loadLayers();
    const pollId = window.setInterval(() => void loadLayers(), 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [
    setGlobalAircraft,
    setGlobalAudio,
    setGlobalFlock,
    setGlobalWebcams,
    setLayerHealth,
    setStatusMessage,
  ]);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_TELEMETRY_WS;
    if (!wsUrl) return;

    let ws: WebSocket | null = null;
    let closed = false;
    let retryMs = 2000;
    let retryTimer: number | undefined;

    const applyAircraft = (list: unknown, source: string) => {
      if (!Array.isArray(list)) return;
      const mapped = list
        .map((row) => mapTelemetryAircraft(row as Record<string, unknown>))
        .filter((a): a is Aircraft => a != null);
      setGlobalAircraft(mapped);
      telemetryLiveRef.current = true;
      setLayerHealth("aircraft", {
        status: source.includes("demo") ? "degraded" : "live",
        source: `ws:${source}`,
        updatedAt: new Date().toISOString(),
        count: mapped.length,
      });
    };

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        retryTimer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30_000);
        return;
      }

      ws.onopen = () => {
        retryMs = 2000;
        setStatusMessage("TELEMETRY UPLINK ESTABLISHED");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            type?: string;
            aircraft?: unknown;
            source?: string;
          };
          if (msg.aircraft) {
            applyAircraft(msg.aircraft, msg.source ?? "telemetry");
          }
        } catch {
          /* ignore malformed frames */
        }
      };

      ws.onclose = () => {
        telemetryLiveRef.current = false;
        if (!closed) {
          retryTimer = window.setTimeout(connect, retryMs);
          retryMs = Math.min(retryMs * 2, 30_000);
        }
      };

      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      ws?.close();
      telemetryLiveRef.current = false;
    };
  }, [setGlobalAircraft, setLayerHealth, setStatusMessage]);

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
      if (meta?.fromUser) userInspectedRef.current = true;

      inspectAbortRef.current?.abort();
      const ac = new AbortController();
      inspectAbortRef.current = ac;

      const radius = clampRadiusMiles(
        useMasterEyeStore.getState().sectorRadiusMiles
      );

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
          `/api/region?lat=${lat}&lon=${lon}&radiusMiles=${radius}`,
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
          radiusMeters:
            data.radiusMeters ?? milesToMeters(data.radiusMiles),
          webcams: data.webcams ?? [],
          audioFeeds: data.audioFeeds ?? [],
          aircraft: data.aircraft ?? [],
          flockCameras: data.flockCameras ?? [],
          queriedAt:
            data.queriedAt ?? data.queriedAt ?? new Date().toISOString(),
        };
        setInspection(inspection);

        if (inspection.flockCameras.length > 0) {
          setGlobalFlock(
            mergeFlockCameras(
              useMasterEyeStore.getState().globalFlock,
              inspection.flockCameras
            )
          );
        }

        const flockSrc = data.sources?.flock ?? "n/a";
        const emerg = inspection.aircraft.filter((a) =>
          isEmergencySquawk(a.squawk)
        ).length;
        setStatusMessage(
          `SECTOR RESOLVED // ⌀${inspection.radiusMiles}mi · ${inspection.webcams.length} CAM · ${inspection.aircraft.length} ACFT · ${inspection.audioFeeds.length} AUDIO · ${inspection.flockCameras.length} FLOCK (${flockSrc})${emerg ? ` · ${emerg} EMERG` : ""}`
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

  useEffect(() => {
    if (lastRadiusRef.current === sectorRadiusMiles) return;
    lastRadiusRef.current = sectorRadiusMiles;
    const inspection = useMasterEyeStore.getState().inspection;
    if (!inspection) return;
    void runInspection(inspection.latitude, inspection.longitude, {
      fromUser: true,
    });
  }, [sectorRadiusMiles, runInspection]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#030712]">
      <div className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(3,7,18,0.65)_100%)]" />
      <div className="pointer-events-none absolute inset-0 z-20 opacity-[0.07] mix-blend-overlay [background-image:repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(34,211,238,0.15)_3px)]" />

      <ErrorBoundary
        fallbackTitle="Globe Rendering Fault"
        onReset={() => setGlobeEpoch((n) => n + 1)}
      >
        <GlobeView
          key={globeEpoch}
          webcams={globalWebcams}
          audioFeeds={globalAudio}
          aircraft={globalAircraft}
          flockCameras={globalFlock}
          onInspect={handleInspect}
        />
      </ErrorBoundary>

      <HudToolbar onGoto={(lat, lon) => handleInspect(lat, lon)} />

      <ErrorBoundary fallbackTitle="Inspector Fault">
        <RegionalInspector />
      </ErrorBoundary>
    </main>
  );
}
