import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CONCURRENT_STREAMS = 8;
let activeStreams = 0;

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
 * Connect timeout only: abort timer is cleared once headers arrive so
 * Icecast/LiveATC bodies are not killed after 12s.
 */
async function fetchAllowlistedStream(startUrl: string): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop < 4; hop++) {
    if (!isAllowedStreamUrl(current)) {
      throw new Error("Redirect target not allowlisted");
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12_000);
    let upstream: Response;
    try {
      upstream = await fetch(current, {
        headers: {
          "User-Agent": "MASTER-EYE-AudioProxy/1.1",
          Accept: "*/*",
          Connection: "keep-alive",
          "Icy-MetaData": "1",
        },
        redirect: "manual",
        // @ts-expect-error Node fetch duplex not typed in all versions
        duplex: "half",
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const location = upstream.headers.get("location");
      if (!location) {
        throw new Error("Redirect without Location header");
      }
      void upstream.body?.cancel();
      current = new URL(location, current).toString();
      continue;
    }

    return upstream;
  }

  throw new Error("Too many redirects");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // searchParams.get already percent-decodes; do not decodeURIComponent again.
  const target = searchParams.get("url");

  if (!target) {
    return NextResponse.json(
      { error: "Missing required query parameter: url" },
      { status: 400 }
    );
  }

  if (!isAllowedStreamUrl(target)) {
    return NextResponse.json(
      {
        error:
          "Stream host not allowlisted. Supported: LiveATC, Broadcastify, RadioReference.",
      },
      { status: 403 }
    );
  }

  if (activeStreams >= MAX_CONCURRENT_STREAMS) {
    return NextResponse.json(
      { error: "Audio proxy at capacity — try again shortly" },
      { status: 503 }
    );
  }

  try {
    const upstream = await fetchAllowlistedStream(target);

    if (!upstream.ok || !upstream.body) {
      void upstream.body?.cancel();
      return NextResponse.json(
        {
          error: `Upstream stream returned ${upstream.status}`,
          status: upstream.status,
        },
        { status: 502 }
      );
    }

    // Re-check after connect in case we raced past the gate.
    if (activeStreams >= MAX_CONCURRENT_STREAMS) {
      void upstream.body.cancel();
      return NextResponse.json(
        { error: "Audio proxy at capacity — try again shortly" },
        { status: 503 }
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

    activeStreams += 1;
    const body = upstream.body;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeStreams = Math.max(0, activeStreams - 1);
    };

    const stream = new ReadableStream({
      start(controller) {
        const reader = body.getReader();
        const pump = (): Promise<void> =>
          reader
            .read()
            .then(({ done, value }) => {
              if (done) {
                release();
                controller.close();
                return;
              }
              controller.enqueue(value);
              return pump();
            })
            .catch((err) => {
              release();
              controller.error(err);
            });
        return pump();
      },
      cancel() {
        release();
        void body.cancel();
      },
    });

    return new NextResponse(stream, {
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
