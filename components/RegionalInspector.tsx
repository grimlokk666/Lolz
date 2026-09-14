"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Crosshair,
  Plane,
  Radio,
  Video,
  X,
  Search,
  Lock,
  MapPin,
  Scan,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import AudioPlayer from "@/components/AudioPlayer";
import { useMasterEyeStore } from "@/lib/store";
import {
  formatAltitudeFt,
  formatCoord,
  formatHeading,
  formatSpeedKt,
  metersToMiles,
} from "@/lib/utils";
import { cn } from "@/lib/utils";

export default function RegionalInspector() {
  const inspectorOpen = useMasterEyeStore((s) => s.inspectorOpen);
  const inspection = useMasterEyeStore((s) => s.inspection);
  const inspectionLoading = useMasterEyeStore((s) => s.inspectionLoading);
  const inspectionError = useMasterEyeStore((s) => s.inspectionError);
  const closeInspector = useMasterEyeStore((s) => s.closeInspector);
  const trackAircraft = useMasterEyeStore((s) => s.trackAircraft);
  const trackedAircraftId = useMasterEyeStore((s) => s.trackedAircraftId);
  const selectedAircraftId = useMasterEyeStore((s) => s.selectedAircraftId);
  const selectAircraft = useMasterEyeStore((s) => s.selectAircraft);
  const setFlyToTarget = useMasterEyeStore((s) => s.setFlyToTarget);

  const [airQuery, setAirQuery] = useState("");
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState("cams");

  useEffect(() => {
    setAirQuery("");
    setImgErrors({});
    setTab("cams");
  }, [inspection?.queriedAt]);

  useEffect(() => {
    if (!inspectorOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeInspector();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspectorOpen, closeInspector]);

  const filteredAircraft = useMemo(() => {
    const list = inspection?.aircraft ?? [];
    const q = airQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (a) =>
        a.callsign?.toLowerCase().includes(q) ||
        a.icao24.toLowerCase().includes(q) ||
        a.squawk?.includes(q) ||
        a.originCountry?.toLowerCase().includes(q)
    );
  }, [inspection?.aircraft, airQuery]);

  if (!inspectorOpen) return null;

  return (
    <aside
      className={cn(
        "pointer-events-auto absolute bottom-0 right-0 top-0 z-50 flex w-full max-w-md flex-col border-l border-cyan-500/40 bg-black/80 shadow-[-20px_0_60px_rgba(0,0,0,0.65)] backdrop-blur-md transition-transform duration-500 ease-out",
        inspectorOpen ? "translate-x-0" : "translate-x-full"
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-cyan-500/30 px-4 py-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]">
            <Crosshair className="h-3.5 w-3.5" />
            Tactical Regional Inspector
          </div>
          {inspection && (
            <div className="mt-1 font-mono text-xs text-cyan-100">
              <MapPin className="mr-1 inline h-3 w-3 text-cyan-500" />
              {formatCoord(inspection.latitude)}, {formatCoord(inspection.longitude)}
              <span className="ml-2 text-cyan-600">
                ⌀ {inspection.radiusMiles} mi
              </span>
            </div>
          )}
          {inspectionLoading && !inspection && (
            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-cyan-600">
              Acquiring sector lock…
            </div>
          )}
        </div>
        <Button size="icon" variant="ghost" onClick={closeInspector} aria-label="Close inspector">
          <X className="h-4 w-4" />
        </Button>
      </header>

      {inspectionLoading && !inspection && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="font-mono text-xs uppercase tracking-widest text-cyan-400 animate-pulse">
            Sector sweep in progress
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-cyan-700">
            Cams · Air · Audio · Flock / ALPR
          </div>
        </div>
      )}

      {inspectionLoading && inspection && (
        <div className="border-b border-cyan-500/20 bg-cyan-950/30 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-cyan-400 animate-pulse">
          Re-sweeping sector…
        </div>
      )}

      {inspectionError && !inspectionLoading && (
        <div className="m-4 border border-red-500/40 bg-red-950/40 p-3 font-mono text-xs text-red-200">
          {inspectionError}
        </div>
      )}

      {inspection && (
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="relative z-20 shrink-0">
            <TabsTrigger value="cams" type="button">
              <Video className="mr-1 h-3 w-3" />
              Cams ({inspection.webcams.length})
            </TabsTrigger>
            <TabsTrigger value="air" type="button">
              <Plane className="mr-1 h-3 w-3" />
              Air ({inspection.aircraft.length})
            </TabsTrigger>
            <TabsTrigger value="audio" type="button">
              <Radio className="mr-1 h-3 w-3" />
              Audio ({inspection.audioFeeds.length})
            </TabsTrigger>
            <TabsTrigger value="flock" type="button">
              <Scan className="mr-1 h-3 w-3" />
              Flock ({inspection.flockCameras?.length ?? 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cams" className="min-h-0 flex-1">
            <ScrollArea className="h-[calc(100vh-9.5rem)]">
              <div className="space-y-3 p-3">
                {inspection.webcams.length === 0 && (
                  <EmptyState text="No open webcams in sector radius" />
                )}
                {inspection.webcams.map((cam) => (
                  <div
                    key={cam.id}
                    className="overflow-hidden rounded-sm border border-cyan-500/30 bg-black/40"
                  >
                    <div className="relative aspect-video bg-[#020617]">
                      {!imgErrors[cam.id] && cam.snapshotUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cam.streamUrl || cam.snapshotUrl}
                          alt={cam.title ?? cam.ip}
                          className="h-full w-full object-cover opacity-90"
                          onError={() =>
                            setImgErrors((e) => ({ ...e, [cam.id]: true }))
                          }
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center font-mono text-[10px] uppercase tracking-widest text-cyan-700">
                          Snapshot unavailable
                        </div>
                      )}
                      <div className="absolute left-2 top-2 rounded-sm border border-cyan-400/50 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-cyan-300">
                        LIVE CAM
                      </div>
                    </div>
                    <div className="space-y-1 p-2.5">
                      <div className="font-mono text-xs text-cyan-100">
                        {cam.title ?? cam.product ?? "Unknown node"}
                      </div>
                      <div className="font-mono text-[10px] text-cyan-500">
                        {cam.ip}:{cam.port} · {cam.city ?? "—"},{" "}
                        {cam.countryCode ?? cam.country ?? "—"}
                      </div>
                      {cam.distanceM != null && (
                        <div className="font-mono text-[10px] text-cyan-700">
                          {metersToMiles(cam.distanceM).toFixed(1)} mi ·{" "}
                          {cam.protocol.toUpperCase()}
                        </div>
                      )}
                      {cam.tags?.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {cam.tags.map((tag) => (
                            <span
                              key={tag}
                              className="border border-cyan-500/20 px-1 py-0.5 font-mono text-[9px] uppercase text-cyan-600"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="air" className="min-h-0 flex-1">
            <div className="border-b border-cyan-500/20 p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-cyan-600" />
                <Input
                  value={airQuery}
                  onChange={(e) => setAirQuery(e.target.value)}
                  placeholder="Search callsign / ICAO / squawk"
                  className="pl-7"
                />
              </div>
            </div>
            <ScrollArea className="h-[calc(100vh-12.5rem)]">
              <table className="w-full border-collapse font-mono text-[10px]">
                <thead className="sticky top-0 bg-black/90 text-left text-cyan-500">
                  <tr className="border-b border-cyan-500/20">
                    <th className="px-2 py-2 font-normal uppercase tracking-wider">Callsign</th>
                    <th className="px-2 py-2 font-normal uppercase tracking-wider">Alt</th>
                    <th className="px-2 py-2 font-normal uppercase tracking-wider">Spd</th>
                    <th className="px-2 py-2 font-normal uppercase tracking-wider">Sqk</th>
                    <th className="px-2 py-2 font-normal uppercase tracking-wider">Hdg</th>
                    <th className="px-2 py-2 font-normal uppercase tracking-wider" />
                  </tr>
                </thead>
                <tbody>
                  {filteredAircraft.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-cyan-700">
                        No aircraft in sector
                      </td>
                    </tr>
                  )}
                  {filteredAircraft.map((ac) => {
                    const active =
                      selectedAircraftId === ac.icao24 ||
                      trackedAircraftId === ac.icao24;
                    return (
                      <tr
                        key={ac.icao24}
                        className={cn(
                          "cursor-pointer border-b border-cyan-500/10 transition-colors hover:bg-cyan-500/10",
                          active && "bg-cyan-500/15"
                        )}
                        onClick={() => {
                          selectAircraft(ac.icao24);
                          setFlyToTarget({
                            latitude: ac.latitude,
                            longitude: ac.longitude,
                            entityId: ac.icao24,
                            entityType: "aircraft",
                          });
                        }}
                      >
                        <td className="px-2 py-2 text-cyan-100">
                          <div>{ac.callsign ?? "————"}</div>
                          <div className="text-cyan-700">{ac.icao24}</div>
                        </td>
                        <td className="px-2 py-2 text-cyan-300">
                          {formatAltitudeFt(ac.altitudeM)}
                        </td>
                        <td className="px-2 py-2 text-cyan-300">
                          {formatSpeedKt(ac.velocityMs)}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-2",
                            ac.squawk === "7700" || ac.squawk === "7600"
                              ? "text-red-400"
                              : "text-cyan-300"
                          )}
                        >
                          {ac.squawk ?? "—"}
                        </td>
                        <td className="px-2 py-2 text-cyan-300">
                          {formatHeading(ac.heading)}
                        </td>
                        <td className="px-2 py-2">
                          <Button
                            size="sm"
                            variant={
                              trackedAircraftId === ac.icao24 ? "active" : "ghost"
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              trackAircraft(
                                trackedAircraftId === ac.icao24 ? null : ac.icao24
                              );
                            }}
                          >
                            <Lock className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="audio" className="min-h-0 flex-1">
            <ScrollArea className="h-[calc(100vh-9.5rem)]">
              <div className="space-y-3 p-3">
                {inspection.audioFeeds.length === 0 && (
                  <EmptyState text="No audio nodes in sector radius" />
                )}
                {inspection.audioFeeds.map((feed) => (
                  <div key={feed.id} className="space-y-2">
                    <div className="flex items-center justify-between gap-2 px-0.5">
                      <div>
                        <div className="font-mono text-[9px] uppercase tracking-widest text-violet-400">
                          {feed.feedType}
                        </div>
                        <div className="font-mono text-[10px] text-cyan-600">
                          {feed.city ?? "—"}
                          {feed.distanceM != null &&
                            ` · ${metersToMiles(feed.distanceM).toFixed(1)} mi`}
                        </div>
                      </div>
                    </div>
                    <AudioPlayer
                      streamUrl={feed.streamUrl}
                      label={feed.name}
                      frequency={feed.frequency}
                    />
                    {feed.description && (
                      <p className="px-0.5 font-mono text-[10px] text-cyan-700">
                        {feed.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="flock" className="min-h-0 flex-1">
            <ScrollArea className="h-[calc(100vh-9.5rem)]">
              <div className="space-y-2 p-3">
                {(inspection.flockCameras?.length ?? 0) === 0 && (
                  <EmptyState text="No public ALPR / Flock nodes in sector. Locations are OSM community tags only — not proprietary plate feeds." />
                )}
                {(inspection.flockCameras ?? []).map((cam) => {
                  const hdg =
                    cam.direction != null && Number.isFinite(cam.direction)
                      ? Math.round(cam.direction)
                      : null;
                  return (
                    <button
                      key={cam.id}
                      type="button"
                      className="w-full rounded-sm border border-amber-500/30 bg-black/40 p-3 text-left transition-colors hover:border-amber-400/50 hover:bg-amber-500/5"
                      onClick={() =>
                        setFlyToTarget({
                          latitude: cam.latitude,
                          longitude: cam.longitude,
                          entityId: cam.id,
                          entityType: "flock",
                        })
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-mono text-[9px] uppercase tracking-widest text-amber-400">
                            {cam.manufacturer ?? "ALPR"} · {cam.surveillanceType}
                          </div>
                          <div className="truncate font-mono text-xs text-cyan-100">
                            {cam.name ?? cam.model ?? cam.id}
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-cyan-600">
                            {[cam.city, cam.state, cam.countryCode]
                              .filter(Boolean)
                              .join(", ") || "Unknown locale"}
                          </div>
                          {cam.operator && (
                            <div className="font-mono text-[10px] text-cyan-700">
                              OP {cam.operator}
                            </div>
                          )}
                        </div>
                        <div className="shrink-0 text-right font-mono text-[9px] text-amber-500/80">
                          {cam.distanceM != null
                            ? `${metersToMiles(cam.distanceM).toFixed(1)} mi`
                            : cam.source.toUpperCase()}
                          {hdg != null && <div>HDG {hdg}°</div>}
                          <div className="mt-1 text-cyan-800">{cam.source}</div>
                        </div>
                      </div>
                      {cam.tags?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {cam.tags.slice(0, 6).map((tag) => (
                            <span
                              key={tag}
                              className="border border-amber-500/20 px-1 py-0.5 font-mono text-[9px] uppercase text-amber-600"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      {cam.osmId && (
                        <div className="mt-2 font-mono text-[9px] text-cyan-800">
                          OSM {cam.osmId} · click to fly-to
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      )}
    </aside>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="border border-dashed border-cyan-500/20 px-3 py-10 text-center font-mono text-[10px] uppercase tracking-widest text-cyan-700">
      {text}
    </div>
  );
}
