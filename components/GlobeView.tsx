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
  ImageryLayer,
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
import type { Aircraft, AudioFeed, WebcamAsset } from "@/types/master-eye";

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
  onInspect: (
    lat: number,
    lon: number,
    meta?: { entityId?: string; entityType?: "aircraft" | "webcam" | "audio" }
  ) => void;
}

function headingToColor(heading: number | null): Color {
  if (heading == null) return Color.CYAN;
  const t = ((((heading % 360) + 360) % 360) / 360);
  return Color.fromHsl(0.5 + t * 0.15, 0.9, 0.55);
}

export default function GlobeView({
  webcams,
  audioFeeds,
  aircraft,
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
          // Bundled Natural Earth II — no external tile CORS / rate limits
          const provider = await TileMapServiceImageryProvider.fromUrl(
            buildModuleUrl("Assets/Textures/NaturalEarthII")
          );
          if (!cancelled && !viewer.isDestroyed()) {
            viewer.imageryLayers.add(new ImageryLayer(provider));
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
            viewer.imageryLayers.add(new ImageryLayer(provider));
          }
        } catch (fallbackErr) {
          console.warn("[GlobeView] imagery fallback failed", fallbackErr);
        }
      } finally {
        if (!cancelled) setReady(true);
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
    };
  }, [handleViewerReady]);

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
  }, [tracked]);

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
          webcams.map((cam) => (
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
                color={Color.fromCssColorString("#22d3ee").withAlpha(0.95)}
                outlineColor={Color.fromCssColorString("#083344")}
                outlineWidth={2}
                scaleByDistance={new NearFarScalar(1.5e2, 1.4, 1.5e7, 0.4)}
                distanceDisplayCondition={new DistanceDisplayCondition(0, 2.5e7)}
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
                pixelOffset={new Cartesian2(0, -18)}
                disableDepthTestDistance={Number.POSITIVE_INFINITY}
                distanceDisplayCondition={new DistanceDisplayCondition(0, 3e6)}
                showBackground
                backgroundColor={Color.fromCssColorString("#030712").withAlpha(
                  0.75
                )}
              />
            </Entity>
          ))}

        {ready &&
          layers.audio &&
          audioFeeds.map((feed) => (
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
                color={Color.fromCssColorString("#a78bfa").withAlpha(0.95)}
                outlineColor={Color.fromCssColorString("#2e1065")}
                outlineWidth={2}
                scaleByDistance={new NearFarScalar(1.5e2, 1.3, 1.5e7, 0.35)}
              />
              <LabelGraphics
                text="AUDIO"
                font="10px monospace"
                fillColor={Color.fromCssColorString("#c4b5fd")}
                outlineColor={Color.BLACK}
                outlineWidth={2}
                style={LabelStyle.FILL_AND_OUTLINE}
                verticalOrigin={VerticalOrigin.BOTTOM}
                pixelOffset={new Cartesian2(0, -16)}
                disableDepthTestDistance={Number.POSITIVE_INFINITY}
                distanceDisplayCondition={new DistanceDisplayCondition(0, 3e6)}
                showBackground
                backgroundColor={Color.fromCssColorString("#030712").withAlpha(
                  0.75
                )}
              />
            </Entity>
          ))}

        {ready &&
          layers.aircraft &&
          aircraft.map((ac) => (
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
                  trackedAircraftId === ac.icao24
                    ? Color.fromCssColorString("#fbbf24")
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
                    ? Color.fromCssColorString("#fde68a")
                    : Color.fromCssColorString("#67e8f9")
                }
                outlineColor={Color.BLACK}
                outlineWidth={2}
                style={LabelStyle.FILL_AND_OUTLINE}
                verticalOrigin={VerticalOrigin.BOTTOM}
                pixelOffset={new Cartesian2(0, -14)}
                disableDepthTestDistance={Number.POSITIVE_INFINITY}
                distanceDisplayCondition={new DistanceDisplayCondition(0, 2.5e6)}
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
