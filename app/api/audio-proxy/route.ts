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
    const upstream = await fetch(decoded, {
      headers: {
        "User-Agent": "MASTER-EYE-AudioProxy/1.0",
        Accept: "*/*",
        Connection: "keep-alive",
        "Icy-MetaData": "1",
      },
      redirect: "follow",
      // @ts-expect-error Node fetch duplex not typed in all versions
      duplex: "half",
      signal: AbortSignal.timeout(20_000),
    });

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
      "Transfer-Encoding": "chunked",
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
