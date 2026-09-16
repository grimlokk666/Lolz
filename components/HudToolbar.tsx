"use client";

import React, { useState } from "react";
import {
  Eye,
  Plane,
  Radio,
  Video,
  Activity,
  Satellite,
  Scan,
  Crosshair,
  CircleDot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMasterEyeStore, type LayerHealthStatus } from "@/lib/store";
import { clampLat, clampLon, clampRadiusMiles, cn } from "@/lib/utils";
import type { LayerId } from "@/types/master-eye";

const LAYER_META: {
  id: LayerId;
  label: string;
  icon: React.ReactNode;
}[] = [
  { id: "aircraft", label: "Aircraft", icon: <Plane className="h-3.5 w-3.5" /> },
  { id: "webcams", label: "Webcams", icon: <Video className="h-3.5 w-3.5" /> },
  { id: "audio", label: "Audio", icon: <Radio className="h-3.5 w-3.5" /> },
  { id: "flock", label: "Flock ALPR", icon: <Scan className="h-3.5 w-3.5" /> },
];

function healthColor(status: LayerHealthStatus): string {
  switch (status) {
    case "live":
      return "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]";
    case "degraded":
      return "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]";
    case "error":
      return "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]";
    default:
      return "bg-cyan-900";
  }
}

interface HudToolbarProps {
  onGoto?: (lat: number, lon: number) => void;
}

export default function HudToolbar({ onGoto }: HudToolbarProps) {
  const layers = useMasterEyeStore((s) => s.layers);
  const toggleLayer = useMasterEyeStore((s) => s.toggleLayer);
  const layerHealth = useMasterEyeStore((s) => s.layerHealth);
  const statusMessage = useMasterEyeStore((s) => s.statusMessage);
  const clock = useMasterEyeStore((s) => s.clock);
  const globalAircraft = useMasterEyeStore((s) => s.globalAircraft);
  const globalWebcams = useMasterEyeStore((s) => s.globalWebcams);
  const globalAudio = useMasterEyeStore((s) => s.globalAudio);
  const globalFlock = useMasterEyeStore((s) => s.globalFlock);
  const sectorRadiusMiles = useMasterEyeStore((s) => s.sectorRadiusMiles);
  const setSectorRadiusMiles = useMasterEyeStore((s) => s.setSectorRadiusMiles);

  const [coordInput, setCoordInput] = useState("");
  const [gotoError, setGotoError] = useState<string | null>(null);

  const submitGoto = (e: React.FormEvent) => {
    e.preventDefault();
    setGotoError(null);
    const parts = coordInput
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (parts.length < 2) {
      setGotoError("Enter lat, lon");
      return;
    }
    const lat = clampLat(parts[0]);
    const lon = clampLon(parts[1]);
    onGoto?.(lat, lon);
  };

  return (
    <>
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex items-start justify-between p-4">
        <div className="pointer-events-auto rounded-sm border border-cyan-500/40 bg-black/70 px-4 py-3 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border border-cyan-400/50 bg-cyan-500/10 shadow-[0_0_20px_rgba(34,211,238,0.25)]">
              <Eye className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <h1 className="font-mono text-xl font-bold tracking-[0.2em] text-cyan-100 drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]">
                MASTER EYE
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-cyan-500">
                Global Overwatch // Tactical ISR
              </p>
            </div>
          </div>
        </div>

        <div className="pointer-events-auto rounded-sm border border-cyan-500/40 bg-black/70 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-cyan-300 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <Satellite className="h-3.5 w-3.5 animate-pulse text-cyan-400" />
            <span
              className="drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]"
              suppressHydrationWarning
            >
              {clock
                ? `${new Date(clock).toISOString().replace("T", " ").slice(0, 19)} Zulu`
                : "SYNC…"}
            </span>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute left-4 top-28 z-30">
        <div className="pointer-events-auto w-56 rounded-sm border border-cyan-500/40 bg-black/70 p-2 backdrop-blur-md">
          <div className="mb-2 flex items-center gap-1.5 px-1 font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-500">
            <Activity className="h-3 w-3" />
            Spatial Layers
          </div>
          <div className="space-y-1">
            {LAYER_META.map((layer) => {
              const health = layerHealth[layer.id];
              return (
                <Button
                  key={layer.id}
                  variant={layers[layer.id] ? "active" : "ghost"}
                  className="w-full justify-start"
                  onClick={() => toggleLayer(layer.id)}
                  title={`${health.source} · ${health.status}`}
                >
                  {layer.icon}
                  {layer.label}
                  <span
                    className={cn(
                      "ml-auto h-1.5 w-1.5 rounded-full",
                      layers[layer.id]
                        ? healthColor(health.status)
                        : "bg-cyan-900"
                    )}
                  />
                </Button>
              );
            })}
          </div>

          <div className="mt-3 space-y-1 border-t border-cyan-500/20 pt-2 font-mono text-[9px] text-cyan-600">
            <div className="flex justify-between px-1">
              <span>ACFT</span>
              <span className="text-cyan-400">{globalAircraft.length}</span>
            </div>
            <div className="flex justify-between px-1">
              <span>CAMS</span>
              <span className="text-cyan-400">{globalWebcams.length}</span>
            </div>
            <div className="flex justify-between px-1">
              <span>AUDIO</span>
              <span className="text-cyan-400">{globalAudio.length}</span>
            </div>
            <div className="flex justify-between px-1">
              <span>FLOCK</span>
              <span className="text-amber-400">{globalFlock.length}</span>
            </div>
          </div>

          <div className="mt-3 border-t border-cyan-500/20 pt-2">
            <div className="mb-1 flex items-center gap-1 px-1 font-mono text-[9px] uppercase tracking-widest text-cyan-500">
              <CircleDot className="h-3 w-3" />
              Sector ⌀ {sectorRadiusMiles} mi
            </div>
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={sectorRadiusMiles}
              onChange={(e) =>
                setSectorRadiusMiles(clampRadiusMiles(Number(e.target.value)))
              }
              className="w-full accent-cyan-400"
              aria-label="Sector radius miles"
            />
          </div>

          <form
            onSubmit={submitGoto}
            className="mt-3 space-y-1.5 border-t border-cyan-500/20 pt-2"
          >
            <div className="flex items-center gap-1 px-1 font-mono text-[9px] uppercase tracking-widest text-cyan-500">
              <Crosshair className="h-3 w-3" />
              Goto
            </div>
            <Input
              value={coordInput}
              onChange={(e) => setCoordInput(e.target.value)}
              placeholder="40.71, -74.00"
              className="h-7 font-mono text-[10px]"
            />
            {gotoError && (
              <div className="px-1 font-mono text-[9px] text-red-400">
                {gotoError}
              </div>
            )}
            <Button type="submit" variant="outline" className="h-7 w-full text-[10px]">
              Lock Coordinates
            </Button>
          </form>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-30 flex justify-center md:right-auto md:justify-start">
        <div className="pointer-events-auto max-w-xl truncate rounded-sm border border-cyan-500/40 bg-black/70 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-300 backdrop-blur-md drop-shadow-[0_0_8px_rgba(6,182,212,0.35)]">
          {statusMessage}
        </div>
      </div>
    </>
  );
}
