"use client";

import React, { useEffect, useRef, useState } from "react";
import { Pause, Play, Radio, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AudioPlayerProps {
  streamUrl: string;
  label: string;
  frequency?: string | null;
  className?: string;
}

export default function AudioPlayer({
  streamUrl,
  label,
  frequency,
  className,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const proxyUrl = `/api/audio-proxy?url=${encodeURIComponent(streamUrl)}`;

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try {
        ctxRef.current?.close();
      } catch {
        /* noop */
      }
    };
  }, []);

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const data = new Uint8Array(bufferLength);

    const render = () => {
      analyser.getByteFrequencyData(data);
      ctx.fillStyle = "rgba(3, 7, 18, 0.85)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.2;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (data[i] / 255) * canvas.height;
        const hue = 180 + (data[i] / 255) * 40;
        ctx.fillStyle = `hsla(${hue}, 90%, 55%, 0.85)`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }

      // Baseline grid
      ctx.strokeStyle = "rgba(34, 211, 238, 0.15)";
      ctx.beginPath();
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      rafRef.current = requestAnimationFrame(render);
    };
    render();
  };

  const ensureAudioGraph = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!ctxRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctxRef.current = new AudioCtx();
      analyserRef.current = ctxRef.current.createAnalyser();
      analyserRef.current.fftSize = 128;
      sourceRef.current = ctxRef.current.createMediaElementSource(audio);
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(ctxRef.current.destination);
    }
    if (ctxRef.current.state === "suspended") {
      await ctxRef.current.resume();
    }
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);

    if (playing) {
      audio.pause();
      setPlaying(false);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    try {
      audio.crossOrigin = "anonymous";
      if (audio.src !== proxyUrl) {
        audio.src = proxyUrl;
        audio.load();
      }
      await ensureAudioGraph();
      await audio.play();
      setPlaying(true);
      setConnected(true);
      drawWaveform();
    } catch (err) {
      setPlaying(false);
      setConnected(false);
      setError(
        err instanceof Error
          ? err.message
          : "Stream unavailable — check proxy / upstream"
      );
    }
  };

  return (
    <div
      className={cn(
        "rounded-sm border border-cyan-500/30 bg-black/50 p-3",
        className
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-violet-300">
            <Radio className="h-3 w-3" />
            Audio uplink
          </div>
          <div className="truncate font-mono text-xs text-cyan-100">{label}</div>
          {frequency && (
            <div className="font-mono text-[10px] text-cyan-500">
              FREQ {frequency} MHz
            </div>
          )}
        </div>
        <Button
          size="icon"
          variant={playing ? "active" : "outline"}
          onClick={toggle}
          aria-label={playing ? "Pause stream" : "Play stream"}
        >
          {playing ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      <canvas
        ref={canvasRef}
        width={320}
        height={56}
        className="h-14 w-full rounded-sm border border-cyan-500/20 bg-[#030712]"
      />

      <div className="mt-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-cyan-600">
        <span className="inline-flex items-center gap-1">
          <Volume2 className="h-3 w-3" />
          {connected ? (playing ? "Live" : "Standby") : "Idle"}
        </span>
        <span className="truncate max-w-[60%] text-right opacity-70">
          via audio-proxy
        </span>
      </div>

      {error && (
        <div className="mt-2 border border-red-500/40 bg-red-950/40 px-2 py-1 font-mono text-[10px] text-red-300">
          {error}
        </div>
      )}

      <audio
        ref={audioRef}
        preload="none"
        onError={() => {
          setError("Stream decode failure or upstream offline");
          setPlaying(false);
          setConnected(false);
        }}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}
