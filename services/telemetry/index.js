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
const POLL_MS = Number(process.env.TELEMETRY_POLL_MS || 30000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
  : null;

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

let lastAircraft = [];
let lastSource = "idle";
let lastPollAt = null;

let cachedToken = null;
let tokenExpiresAt = 0;

async function getOpenSkyBearer() {
  const clientId = (process.env.OPENSKY_CLIENT_ID || "").trim();
  const clientSecret = (process.env.OPENSKY_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) return null;

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken;

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
  const tiles = (
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

  const merged = [];
  const seen = new Set();
  for (const tile of tiles) {
    const [lamin, lomin, lamax, lomax] = tile.split(",").map(Number);
    if (![lamin, lomin, lamax, lomax].every(Number.isFinite)) continue;
    const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lamax=${lamax}&lomin=${lomin}&lomax=${lomax}`;
    const res = await axios.get(url, { headers, timeout: 12000 });
    for (const ac of mapOpenSkyStates(res.data?.states)) {
      if (seen.has(ac.icao24)) continue;
      seen.add(ac.icao24);
      merged.push(ac);
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
    // Keep table lean — purge older than 15 minutes
    await client.query(
      "DELETE FROM aircraft_snapshots WHERE recorded_at < NOW() - INTERVAL '15 minutes'"
    );
    for (const a of aircraft.slice(0, 200)) {
      await client.query(
        `INSERT INTO aircraft_snapshots
          (icao24, callsign, origin_country, latitude, longitude, altitude_m, velocity_ms, heading, vertical_rate, squawk, on_ground)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
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
          a.onGround,
        ]
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
    console.warn("[telemetry] OpenSky poll failed, using demo:", err.message);
    lastAircraft = generateDemo();
    lastSource = "demo";
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
