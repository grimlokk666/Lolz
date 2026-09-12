"use client";

import React from "react";
import {
  Eye,
  Plane,
  Radio,
  Video,
  Activity,
  Satellite,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMasterEyeStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { LayerId } from "@/types/master-eye";

const LAYER_META: {
  id: LayerId;
  label: string;
  icon: React.ReactNode;
}[] = [
  { id: "aircraft", label: "Aircraft", icon: <Plane className="h-3.5 w-3.5" /> },
  { id: "webcams", label: "Webcams", icon: <Video className="h-3.5 w-3.5" /> },
  { id: "audio", label: "Audio", icon: <Radio className="h-3.5 w-3.5" /> },
];

export default function HudToolbar() {
  const layers = useMasterEyeStore((s) => s.layers);
  const toggleLayer = useMasterEyeStore((s) => s.toggleLayer);
  const statusMessage = useMasterEyeStore((s) => s.statusMessage);
  const clock = useMasterEyeStore((s) => s.clock);
  const globalAircraft = useMasterEyeStore((s) => s.globalAircraft);
  const globalWebcams = useMasterEyeStore((s) => s.globalWebcams);
  const globalAudio = useMasterEyeStore((s) => s.globalAudio);

  return (
    <>
      {/* Top brand bar */}
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
            <span className="drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]">
              {new Date(clock).toISOString().replace("T", " ").slice(0, 19)} Zulu
            </span>
          </div>
        </div>
      </div>

      {/* Layer toolbar */}
      <div className="pointer-events-none absolute left-4 top-28 z-30">
        <div className="pointer-events-auto w-48 rounded-sm border border-cyan-500/40 bg-black/70 p-2 backdrop-blur-md">
          <div className="mb-2 flex items-center gap-1.5 px-1 font-mono text-[9px] uppercase tracking-[0.3em] text-cyan-500">
            <Activity className="h-3 w-3" />
            Spatial Layers
          </div>
          <div className="space-y-1">
            {LAYER_META.map((layer) => (
              <Button
                key={layer.id}
                variant={layers[layer.id] ? "active" : "ghost"}
                className="w-full justify-start"
                onClick={() => toggleLayer(layer.id)}
              >
                {layer.icon}
                {layer.label}
                <span
                  className={cn(
                    "ml-auto h-1.5 w-1.5 rounded-full",
                    layers[layer.id]
                      ? "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
                      : "bg-cyan-900"
                  )}
                />
              </Button>
            ))}
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
          </div>
        </div>
      </div>

      {/* Bottom status */}
      <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-30 flex justify-center md:right-auto md:justify-start">
        <div className="pointer-events-auto max-w-xl truncate rounded-sm border border-cyan-500/40 bg-black/70 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-300 backdrop-blur-md drop-shadow-[0_0_8px_rgba(6,182,212,0.35)]">
          {statusMessage}
        </div>
      </div>
    </>
  );
}
