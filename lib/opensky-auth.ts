/**
 * OpenSky OAuth2 client-credentials token helper.
 * Basic username/password auth was retired March 18, 2026.
 * @see https://openskynetwork.github.io/opensky-api/rest.html
 */

const TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

let cachedToken: string | null = null;
let expiresAtMs = 0;

export async function getOpenSkyAuthHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = { Accept: "application/json" };
  const token = await getOpenSkyAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function getOpenSkyAccessToken(): Promise<string | null> {
  const clientId = process.env.OPENSKY_CLIENT_ID?.trim();
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  const now = Date.now();
  if (cachedToken && now < expiresAtMs - 60_000) {
    return cachedToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    if (!res.ok) {
      // Fail open to anonymous OpenSky (lower rate limits) rather than
      // disabling the entire airspace layer when OAuth misconfigured.
      console.warn(
        `[opensky-auth] token request failed (${res.status}); falling back to anonymous`
      );
      return null;
    }

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      console.warn("[opensky-auth] token response missing access_token");
      return null;
    }

    cachedToken = data.access_token;
    expiresAtMs = now + (data.expires_in ?? 1800) * 1000;
    return cachedToken;
  } catch (err) {
    console.warn(
      "[opensky-auth] token fetch error; falling back to anonymous",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
