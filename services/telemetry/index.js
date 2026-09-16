/**
 * MASTER EYE — Telemetry Bridging Microservice
 *
 * Express service that polls OpenSky, optionally caches positions in PostGIS,
 * and fans out live aircraft updates over WebSocket to connected clients.
 */

const express = require("express");
const cors = require("cors");
const http = require("http");
const { WebSocketServer } = require("ws");
const axios = require("axios");
const { Pool } = require("pg");
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env.local") });
require("dotenv").config();

const PORT = Number(process.env.PORT || 4100);
// Default 60s — 6 tiles × 1/min ≈ 8.6k credits/day; with rotation (below) much lower.
const POLL_MS = Number(process.env.TELEMETRY_POLL_MS || 60000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
/** How many bbox tiles to hit per poll cycle (round-robin across the full set). */
const TILES_PER_POLL = Math.max(
  1,
  Number(process.env.OPENSKY_TILES_PER_POLL || 2)
);

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
  : null;

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

let lastAircraft = [];
let lastSource = "idle";
let lastPollAt = null;
let tileCursor = 0;

let cachedToken = null;
let tokenExpiresAt = 0;

async function getOpenSkyBearer() {
  const clientId = (process.env.OPENSKY_CLIENT_ID || "").trim();
  const clientSecret = (process.env.OPENSKY_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) return null;

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken;

  try {
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await axios.post(
      "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
      params.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000,
      }
    );
    cachedToken = res.data.access_token;
    tokenExpiresAt = now + (res.data.expires_in || 1800) * 1000;
    return cachedToken;
  } catch (err) {
    console.warn(
      "[telemetry] OpenSky token failed; using anonymous",
      err.message || err
    );
    return null;
  }
}

async function openskyHeaders() {
  const headers = { Accept: "application/json" };
  const token = await getOpenSkyBearer();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function mapOpenSkyStates(states) {
  if (!Array.isArray(states)) return [];
  const out = [];
  for (const row of states) {
    const lat = row[6];
    const lon = row[5];
    if (lat == null || lon == null) continue;
    out.push({
      icao24: String(row[0]),
      callsign: row[1] ? String(row[1]).trim() : null,
      originCountry: row[2] || null,
      latitude: lat,
      longitude: lon,
      altitudeM: row[7] ?? row[13] ?? null,
      velocityMs: row[9] ?? null,
      heading: row[10] ?? null,
      verticalRate: row[11] ?? null,
      squawk: row[14] ?? null,
      onGround: Boolean(row[8]),
      lastContact: row[4] ?? null,
    });
  }
  return out;
}

async function pollOpenSky() {
  const headers = await openskyHeaders();

  // Credit-aware tiles (≤25 sq° = 1 credit each). Full CONUS costs 4 credits/call
  // and would burn a standard 4,000/day quota in a few hours at 15s polling.
  const allTiles = (
    process.env.OPENSKY_BBOXES ||
    [
      "40.4,-74.5,41.2,-73.5", // NYC
      "33.7,-118.7,34.4,-117.8", // LA
      "41.6,-88.1,42.1,-87.4", // CHI
      "32.5,-97.5,33.2,-96.5", // DFW
      "37.5,-122.6,37.9,-121.9", // SFO
      "25.6,-80.5,26.4,-79.9", // MIA
    ].join(";")
  )
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  // Round-robin a subset each cycle to stay within daily credit budgets.
  const start = tileCursor % Math.max(allTiles.length, 1);
  tileCursor = (start + TILES_PER_POLL) % Math.max(allTiles.length, 1);
  const tiles = [];
  for (let i = 0; i < Math.min(TILES_PER_POLL, allTiles.length); i++) {
    tiles.push(allTiles[(start + i) % allTiles.length]);
  }

  const results = await Promise.allSettled(
    tiles.map(async (tile) => {
      const [lamin, lomin, lamax, lomax] = tile.split(",").map(Number);
      if (![lamin, lomin, lamax, lomax].every(Number.isFinite)) {
        return [];
      }
      const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;
      const res = await axios.get(url, { headers, timeout: 12000 });
      return mapOpenSkyStates(res.data?.states);
    })
  );

  const merged = [];
  const seen = new Set();
  let okTiles = 0;
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    okTiles += 1;
    for (const ac of result.value) {
      if (seen.has(ac.icao24)) continue;
      seen.add(ac.icao24);
      merged.push(ac);
    }
  }

  if (okTiles === 0) {
    throw new Error("all OpenSky tiles failed");
  }

  // Carry forward tracks from tiles not hit this cycle so rotation does not
  // blank out other hubs between polls.
  if (lastSource === "opensky" && lastAircraft.length > 0) {
    const maxAgeSec = Math.ceil((POLL_MS * 4) / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    for (const prev of lastAircraft) {
      if (seen.has(prev.icao24)) continue;
      if (
        prev.lastContact != null &&
        nowSec - prev.lastContact > maxAgeSec
      ) {
        continue;
      }
      seen.add(prev.icao24);
      merged.push(prev);
    }
  }

  return merged;
}

function generateDemo(count = 18) {
  const now = Math.floor(Date.now() / 1000);
  const callsigns = ["UAL442", "DAL218", "AAL100", "SWA1847", "JBU624", "FDX1203"];
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + Date.now() / 60000;
    return {
      icao24: `d${(1000 + i).toString(16)}`,
      callsign: callsigns[i % callsigns.length],
      originCountry: "United States",
      latitude: 39.8 + Math.sin(angle) * 4,
      longitude: -98.5 + Math.cos(angle) * 12,
      altitudeM: 5000 + (i % 7) * 1100,
      velocityMs: 140 + (i % 5) * 20,
      heading: ((angle * 180) / Math.PI + 360) % 360,
      verticalRate: 0,
      squawk: "1200",
      onGround: false,
      lastContact: now,
    };
  });
}

async function cacheSnapshots(aircraft) {
  if (!pool || aircraft.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM aircraft_snapshots WHERE recorded_at < NOW() - INTERVAL '15 minutes'"
    );
    const batch = aircraft.slice(0, 200);
    if (batch.length > 0) {
      const values = [];
      const params = [];
      let i = 1;
      for (const a of batch) {
        values.push(
          `($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`
        );
        params.push(
          a.icao24,
          a.callsign,
          a.originCountry,
          a.latitude,
          a.longitude,
          a.altitudeM,
          a.velocityMs,
          a.heading,
          a.verticalRate,
          a.squawk,
          a.onGround
        );
      }
      await client.query(
        `INSERT INTO aircraft_snapshots
          (icao24, callsign, origin_country, latitude, longitude, altitude_m, velocity_ms, heading, vertical_rate, squawk, on_ground)
         VALUES ${values.join(",")}`,
        params
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.warn("[telemetry] cache failed:", err.message);
  } finally {
    client.release();
  }
}

async function refresh() {
  try {
    const aircraft = await pollOpenSky();
    lastAircraft = aircraft;
    lastSource = "opensky";
    lastPollAt = new Date().toISOString();
    await cacheSnapshots(aircraft);
    broadcast({
      type: "airspace",
      source: lastSource,
      count: aircraft.length,
      aircraft,
      at: lastPollAt,
    });
    console.log(`[telemetry] polled ${aircraft.length} aircraft from OpenSky`);
  } catch (err) {
    console.warn("[telemetry] OpenSky poll failed:", err.message);
    // Keep last good traffic if we have it — never wipe a live picture with demo
    // unless we have nothing to show yet.
    if (lastAircraft.length === 0) {
      lastAircraft = generateDemo();
      lastSource = "demo";
    } else {
      lastSource = `${lastSource}+stale`;
    }
    lastPollAt = new Date().toISOString();
    broadcast({
      type: "airspace",
      source: lastSource,
      count: lastAircraft.length,
      aircraft: lastAircraft,
      at: lastPollAt,
    });
  }
}

app.get("/health", (_req, res) => {
  res.json({
    status: "online",
    service: "master-eye-telemetry",
    source: lastSource,
    aircraft: lastAircraft.length,
    lastPollAt,
  });
});

app.get("/airspace", async (req, res) => {
  try {
    const { lamin, lamax, lomin, lomax } = req.query;
    if (lamin && lamax && lomin && lomax) {
      const headers = await openskyHeaders();
      const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;
      const upstream = await axios.get(url, { headers, timeout: 12000 });
      const aircraft = mapOpenSkyStates(upstream.data?.states);
      return res.json({ aircraft, source: "opensky", count: aircraft.length });
    }
    return res.json({
      aircraft: lastAircraft,
      source: lastSource,
      count: lastAircraft.length,
      lastPollAt,
    });
  } catch (err) {
    return res.status(502).json({
      error: err.message,
      aircraft: lastAircraft,
      source: lastSource,
    });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const sockets = new Set();

function broadcast(payload) {
  const raw = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === 1) ws.send(raw);
  }
}

wss.on("connection", (ws) => {
  sockets.add(ws);
  ws.send(
    JSON.stringify({
      type: "hello",
      service: "master-eye-telemetry",
      aircraft: lastAircraft,
      source: lastSource,
      at: lastPollAt,
    })
  );
  ws.on("close", () => sockets.delete(ws));
});

server.listen(PORT, () => {
  console.log(`[telemetry] MASTER EYE bridge listening on :${PORT}`);
  refresh();
  setInterval(refresh, POLL_MS);
});
