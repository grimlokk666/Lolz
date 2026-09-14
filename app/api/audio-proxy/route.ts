import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_HOST_SUFFIXES = [
  "liveatc.net",
  "broadcastify.com",
  "cdnstream1.com",
  "radioreference.com",
  "hardcoremetro.com",
];

function isAllowedStreamUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return ALLOWED_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
}

/**
 * Follow redirects manually and re-validate each hop against the host
 * allowlist — prevents SSRF via allowlisted CDN → internal IP redirects.
 */
async function fetchAllowlistedStream(startUrl: string): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop < 4; hop++) {
    if (!isAllowedStreamUrl(current)) {
      throw new Error("Redirect target not allowlisted");
    }

    const connectAbort = AbortSignal.timeout(12_000);
    const upstream = await fetch(current, {
      headers: {
        "User-Agent": "MASTER-EYE-AudioProxy/1.1",
        Accept: "*/*",
        Connection: "keep-alive",
        "Icy-MetaData": "1",
      },
      redirect: "manual",
      // @ts-expect-error Node fetch duplex not typed in all versions
      duplex: "half",
      signal: connectAbort,
    });

    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const location = upstream.headers.get("location");
      if (!location) {
        throw new Error("Redirect without Location header");
      }
      current = new URL(location, current).toString();
      continue;
    }

    return upstream;
  }

  throw new Error("Too many redirects");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get("url");

  if (!target) {
    return NextResponse.json(
      { error: "Missing required query parameter: url" },
      { status: 400 }
    );
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return NextResponse.json({ error: "Invalid URL encoding" }, { status: 400 });
  }

  if (!isAllowedStreamUrl(decoded)) {
    return NextResponse.json(
      {
        error:
          "Stream host not allowlisted. Supported: LiveATC, Broadcastify, RadioReference.",
      },
      { status: 403 }
    );
  }

  try {
    // Connect timeout only — do NOT abort the body (Icecast streams are long-lived).
    const upstream = await fetchAllowlistedStream(decoded);

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        {
          error: `Upstream stream returned ${upstream.status}`,
          status: upstream.status,
        },
        { status: 502 }
      );
    }

    const contentType =
      upstream.headers.get("content-type") || "audio/mpeg";
    const icyName = upstream.headers.get("icy-name");
    const icyGenre = upstream.headers.get("icy-genre");
    const icyBr = upstream.headers.get("icy-br");

    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "no-store, no-cache",
      "Access-Control-Allow-Origin": "*",
    });
    if (icyName) headers.set("X-Icy-Name", icyName);
    if (icyGenre) headers.set("X-Icy-Genre", icyGenre);
    if (icyBr) headers.set("X-Icy-Br", icyBr);

    return new NextResponse(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Audio proxy failure";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Range",
    },
  });
}
