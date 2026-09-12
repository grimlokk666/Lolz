import { NextResponse } from "next/server";
import { isDatabaseAvailable } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await isDatabaseAvailable();
  return NextResponse.json({
    status: "online",
    service: "MASTER EYE",
    version: "1.0.0",
    database: db ? "connected" : "fallback",
    timestamp: new Date().toISOString(),
  });
}
