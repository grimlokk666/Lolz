"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Viewer,
  Entity,
  PointGraphics,
  LabelGraphics,
  CameraFlyTo,
  CesiumComponentRef,
} from "resium";
import {
  Cartesian2,
  Cartesian3,
  Color,
  HorizontalOrigin,
  VerticalOrigin,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
  Cartographic,
  Viewer as CesiumViewer,
  createWorldImageryAsync,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
  Ion,
  NearFarScalar,
  DistanceDisplayCondition,
  LabelStyle,
  buildModuleUrl,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useMasterEyeStore } from "@/lib/store";
import { isEmergencySquawk } from "@/lib/utils";
import type { Aircraft, AudioFeed, FlockCamera, WebcamAsset } from "@/types/master-eye";

if (typeof window !== "undefined") {
  (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL =
    "/cesium/";
  // Ensure Cesium module URL builder resolves against our static copy
  (
    buildModuleUrl as typeof buildModuleUrl & {
      setBaseUrl: (url: string) => void;
    }
  ).setBaseUrl("/cesium/");
}

const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
if (ionToken) {
  Ion.defaultAccessToken = ionToken;
}

interface GlobeViewProps {
  webcams: WebcamAsset[];
  audioFeeds: AudioFeed[];
  aircraft: Aircraft[];
  flockCameras: FlockCamera[];
  onInspect: (
    lat: number,
    lon: number,
    meta?: {
      entityId?: string;
      entityType?: "aircraft" | "webcam" | "audio" | "flock";
    }
  ) => void;
}

function headingToColor(heading: number | null): Color {
  if (heading == null) return Color.CYAN;
  const t = ((((heading % 360) + 360) % 360) / 360);
  return Color.fromHsl(0.5 + t * 0.15, 0.9, 0.55);
}

// Module-level Cesium graphics — avoid allocating per-entity on every render
const CAM_NEAR_FAR = new NearFarScalar(1.5e2, 1.4, 1.5e7, 0.4);
const AUDIO_NEAR_FAR = new NearFarScalar(1.5e2, 1.3, 1.5e7, 0.35);
const FLOCK_NEAR_FAR = new NearFarScalar(1.5e2, 1.35, 1.5e7, 0.4);
const LABEL_NEAR_FAR = new DistanceDisplayCondition(0, 3e6);
const POINT_NEAR_FAR = new DistanceDisplayCondition(0, 2.5e7);
const AC_LABEL_NEAR_FAR = new DistanceDisplayCondition(0, 2.5e6);
const LABEL_OFFSET = new Cartesian2(0, -18);
const LABEL_OFFSET_SM = new Cartesian2(0, -16);
const AC_LABEL_OFFSET = new Cartesian2(0, -14);
const CYAN = Color.fromCssColorString("#22d3ee").withAlpha(0.95);
const CYAN_OUTLINE = Color.fromCssColorString("#083344");
const VIOLET = Color.fromCssColorString("#a78bfa").withAlpha(0.95);
const VIOLET_OUTLINE = Color.fromCssColorString("#2e1065");
const AMBER = Color.fromCssColorString("#f59e0b").withAlpha(0.95);
const AMBER_OUTLINE = Color.fromCssColorString("#78350f");
const LABEL_BG = Color.fromCssColorString("#030712").withAlpha(0.75);
const TRACK_GOLD = Color.fromCssColorString("#fbbf24");
const TRACK_LABEL = Color.fromCssColorString("#fde68a");
const AC_LABEL = Color.fromCssColorString("#67e8f9");
const EMERG_RED = Color.fromCssColorString("#f87171");
const FLOCK_LABEL = Color.fromCssColorString("#fcd34d");
const AUDIO_LABEL = Color.fromCssColorString("#c4b5fd");


export default function GlobeView({
  webcams,
  audioFeeds,
  aircraft,
  flockCameras,
  onInspect,
}: GlobeViewProps) {
  const viewerRef = useRef<CesiumComponentRef<CesiumViewer>>(null);
  const onInspectRef = useRef(onInspect);
  const initDoneRef = useRef(false);
  const [ready, setReady] = useState(false);
  const layers = useMasterEyeStore((s) => s.layers);
  const flyToTarget = useMasterEyeStore((s) => s.flyToTarget);
  const trackedAircraftId = useMasterEyeStore((s) => s.trackedAircraftId);
  const setFlyToTarget = useMasterEyeStore((s) => s.setFlyToTarget);

  onInspectRef.current = onInspect;

  const tracked = useMemo(
    () => aircraft.find((a) => a.icao24 === trackedAircraftId) ?? null,
    [aircraft, trackedAircraftId]
  );

  const destination = useMemo(() => {
    if (!flyToTarget) return null;
    return Cartesian3.fromDegrees(
      flyToTarget.longitude,
      flyToTarget.latitude,
      flyToTarget.entityType === "aircraft" ? 80_000 : 120_000
    );
  }, [flyToTarget]);

  const handleViewerReady = useCallback(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer || viewer.isDestroyed() || initDoneRef.current) return;
    initDoneRef.current = true;

    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.atmosphereLightIntensity = 10;
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.hueShift = -0.8;
      viewer.scene.skyAtmosphere.saturationShift = -0.3;
      viewer.scene.skyAtmosphere.brightnessShift = -0.25;
    }
    viewer.scene.fog.enabled = true;
    viewer.scene.backgroundColor = Color.fromCssColorString("#030712");
    viewer.scene.globe.baseColor = Color.fromCssColorString("#0b1220");

    // Hide default credits container without remounting Viewer
    const credit = viewer.cesiumWidget.creditContainer as HTMLElement | undefined;
    if (credit) credit.style.display = "none";

    let cancelled = false;

    (async () => {
      try {
        viewer.imageryLayers.removeAll();
        if (ionToken) {
          const world = await createWorldImageryAsync();
          if (!cancelled && !viewer.isDestroyed()) {
            viewer.imageryLayers.addImageryProvider(world);
          }
        } else {
          // Bundled Natural Earth II — absolute public URL (no Ion required)
          const provider = await TileMapServiceImageryProvider.fromUrl(
            "/cesium/Assets/Textures/NaturalEarthII",
            { fileExtension: "jpg" }
          );
          if (!cancelled && !viewer.isDestroyed()) {
            viewer.imageryLayers.addImageryProvider(provider);
          }
        }
      } catch (err) {
        console.warn("[GlobeView] primary imagery failed, OSM fallback", err);
        try {
          if (!cancelled && !viewer.isDestroyed()) {
            const provider = new UrlTemplateImageryProvider({
              url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
              maximumLevel: 8,
            });
            viewer.imageryLayers.addImageryProvider(provider);
          }
        } catch (fallbackErr) {
          console.warn("[GlobeView] imagery fallback failed", fallbackErr);
        }
      } finally {
        if (!cancelled) {
          setReady(true);
          viewer.scene.requestRender?.();
        }
      }
    })();

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: { position: Cartesian2 }) => {
      const picked = viewer.scene.pick(movement.position) as
        | { id?: { properties?: Record<string, unknown> } }
        | undefined;
      if (defined(picked) && picked?.id?.properties) {
        const props = picked.id.properties;
        const readProp = (key: string): unknown => {
          const raw = props[key];
          if (
            raw &&
            typeof raw === "object" &&
            "getValue" in raw &&
            typeof (raw as { getValue: unknown }).getValue === "function"
          ) {
            return (raw as { getValue: () => unknown }).getValue();
          }
          return raw;
        };
        const lat = readProp("latitude");
        const lon = readProp("longitude");
        const entityType = readProp("entityType");
        const entityId = readProp("entityId");
        if (typeof lat === "number" && typeof lon === "number") {
          onInspectRef.current(lat, lon, {
            entityId: entityId != null ? String(entityId) : undefined,
            entityType: entityType as
              | "aircraft"
              | "webcam"
              | "audio"
              | "flock"
              | undefined,
          });
          return;
        }
      }
      const cartesian = viewer.camera.pickEllipsoid(
        movement.position,
        viewer.scene.globe.ellipsoid
      );
      if (!cartesian) return;
      const carto = Cartographic.fromCartesian(cartesian);
      onInspectRef.current(
        CesiumMath.toDegrees(carto.latitude),
        CesiumMath.toDegrees(carto.longitude)
      );
    }, ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      cancelled = true;
      handler.destroy();
    };
  }, []);

  useEffect(() => {
    // Poll briefly until Resium mounts the Viewer instance
    let attempts = 0;
    let cleanup: (() => void) | undefined;
    const id = window.setInterval(() => {
      attempts += 1;
      const viewer = viewerRef.current?.cesiumElement;
      if (viewer && !viewer.isDestroyed()) {
        window.clearInterval(id);
        cleanup = handleViewerReady() ?? undefined;
      } else if (attempts > 80) {
        window.clearInterval(id);
        setReady(true);
      }
    }, 100);
    return () => {
      window.clearInterval(id);
      cleanup?.();
      // Allow re-init after Strict Mode remount / ErrorBoundary reset
      initDoneRef.current = false;
    };
  }, [handleViewerReady]);

  const trackedKey = tracked
    ? `${tracked.icao24}:${tracked.latitude.toFixed(3)}:${tracked.longitude.toFixed(3)}`
    : null;

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer || viewer.isDestroyed() || !tracked) return;
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(
        tracked.longitude,
        tracked.latitude,
        Math.max((tracked.altitudeM ?? 10000) + 25000, 40000)
      ),
      orientation: {
        heading: CesiumMath.toRadians(tracked.heading ?? 0),
        pitch: CesiumMath.toRadians(-45),
        roll: 0,
      },
      duration: 1.2,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by coarse position to avoid poll thrash
  }, [trackedKey]);

  const handleFlyComplete = useCallback(() => {
    setFlyToTarget(null);
  }, [setFlyToTarget]);

  return (
    <div className="absolute inset-0 h-full w-full">
      <Viewer
        ref={viewerRef}
        full
        animation={false}
        timeline={false}
        baseLayerPicker={false}
        geocoder={false}
        homeButton={false}
        sceneModePicker={false}
        navigationHelpButton={false}
        fullscreenButton={false}
        infoBox={false}
        selectionIndicator={false}
        terrainProvider={undefined}
        className="h-full w-full"
      >
        {destination && (
          <CameraFlyTo
            destination={destination}
            duration={2.0}
            once
            onComplete={handleFlyComplete}
          />
        )}

        {ready &&
          layers.webcams &&
          webcams.slice(0, 300).map((cam) => (
            <Entity
              key={`cam-${cam.id}`}
              name={cam.title ?? cam.ip}
              position={Cartesian3.fromDegrees(cam.longitude, cam.latitude, 500)}
              properties={{
                latitude: cam.latitude,
                longitude: cam.longitude,
                entityType: "webcam",
                entityId: cam.id,
              }}
            >
              <PointGraphics
                pixelSize={12}
                color={CYAN}
                outlineColor={CYAN_OUTLINE}
                outlineWidth={2}
                scaleByDistance={CAM_NEAR_FAR}
                distanceDisplayCondition={POINT_NEAR_FAR}
              />
              <LabelGraphics
                text="CAM"
                font="10px monospace"
                fillColor={Color.CYAN}
                outlineColor={Color.BLACK}
                outlineWidth={2}
                style={LabelStyle.FILL_AND_OUTLINE}
                verticalOrigin={VerticalOrigin.BOTTOM}
                horizontalOrigin={HorizontalOrigin.CENTER}
                pixelOffset={LABEL_OFFSET}
                disableDepthTestDistance={Number.POSITIVE_INFINITY}
                distanceDisplayCondition={LABEL_NEAR_FAR}
                showBackground
                backgroundColor={LABEL_BG}
              />
            </Entity>
          ))}

        {ready &&
          layers.audio &&
          audioFeeds.slice(0, 300).map((feed) => (
            <Entity
              key={`audio-${feed.id}`}
              name={feed.name}
              position={Cartesian3.fromDegrees(
                feed.longitude,
                feed.latitude,
                400
              )}
              properties={{
                latitude: feed.latitude,
                longitude: feed.longitude,
                entityType: "audio",
                entityId: feed.id,
              }}
            >
              <PointGraphics
                pixelSize={10}
                color={VIOLET}
                outlineColor={VIOLET_OUTLINE}
                outlineWidth={2}
                scaleByDistance={AUDIO_NEAR_FAR}
              />
              <LabelGraphics
                text="AUDIO"
                font="10px monospace"
                fillColor={AUDIO_LABEL}
                outlineColor={Color.BLACK}
                outlineWidth={2}
                style={LabelStyle.FILL_AND_OUTLINE}
                verticalOrigin={VerticalOrigin.BOTTOM}
                pixelOffset={LABEL_OFFSET_SM}
                disableDepthTestDistance={Number.POSITIVE_INFINITY}
                distanceDisplayCondition={LABEL_NEAR_FAR}
                showBackground
                backgroundColor={LABEL_BG}
              />
            </Entity>
          ))}

        {ready &&
          layers.flock &&
          flockCameras.slice(0, 800).map((cam) => (
            <Entity
              key={`flock-${cam.id}`}
              name={cam.name ?? cam.manufacturer ?? "ALPR"}
              position={Cartesian3.fromDegrees(
                cam.longitude,
                cam.latitude,
                350
              )}
              properties={{
                latitude: cam.latitude,
                longitude: cam.longitude,
                entityType: "flock",
                entityId: cam.id,
              }}
            >
              <PointGraphics
                pixelSize={11}
                color={AMBER}
                outlineColor={AMBER_OUTLINE}
                outlineWidth={2}
                scaleByDistance={FLOCK_NEAR_FAR}
                distanceDisplayCondition={POINT_NEAR_FAR}
              />
              <LabelGraphics
                text="FLOCK"
                font="10px monospace"
                fillColor={FLOCK_LABEL}
                outlineColor={Color.BLACK}
                outlineWidth={2}
                style={LabelStyle.FILL_AND_OUTLINE}
                verticalOrigin={VerticalOrigin.BOTTOM}
                horizontalOrigin={HorizontalOrigin.CENTER}
                pixelOffset={LABEL_OFFSET_SM}
                disableDepthTestDistance={Number.POSITIVE_INFINITY}
                distanceDisplayCondition={LABEL_NEAR_FAR}
                showBackground
                backgroundColor={LABEL_BG}
              />
            </Entity>
          ))}

        {ready &&
          layers.aircraft &&
          aircraft.slice(0, 600).map((ac) => (
            <Entity
              key={`ac-${ac.icao24}`}
              name={ac.callsign ?? ac.icao24}
              position={Cartesian3.fromDegrees(
                ac.longitude,
                ac.latitude,
                Math.max(ac.altitudeM ?? 8000, 500)
              )}
              properties={{
                latitude: ac.latitude,
                longitude: ac.longitude,
                entityType: "aircraft",
                entityId: ac.icao24,
              }}
            >
              <PointGraphics
                pixelSize={trackedAircraftId === ac.icao24 ? 16 : 9}
                color={
                  isEmergencySquawk(ac.squawk)
                    ? EMERG_RED
                    : trackedAircraftId === ac.icao24
                      ? TRACK_GOLD
                      : headingToColor(ac.heading)
                }
                outlineColor={Color.BLACK}
                outlineWidth={1}
              />
              <LabelGraphics
                text={ac.callsign ?? ac.icao24.toUpperCase()}
                font="11px monospace"
                fillColor={
                  trackedAircraftId === ac.icao24
                    ? TRACK_LABEL
                    : AC_LABEL
                }
                outlineColor={Color.BLACK}
                outlineWidth={2}
                style={LabelStyle.FILL_AND_OUTLINE}
                verticalOrigin={VerticalOrigin.BOTTOM}
                pixelOffset={AC_LABEL_OFFSET}
                disableDepthTestDistance={Number.POSITIVE_INFINITY}
                distanceDisplayCondition={AC_LABEL_NEAR_FAR}
              />
            </Entity>
          ))}
      </Viewer>

      {!ready && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#030712]/80">
          <div className="font-mono text-xs uppercase tracking-[0.35em] text-cyan-300 drop-shadow-[0_0_8px_rgba(6,182,212,0.5)] animate-pulse">
            Initializing globe tessellation…
          </div>
        </div>
      )}
    </div>
  );
}
