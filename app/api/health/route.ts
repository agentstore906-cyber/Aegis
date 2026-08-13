import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Liveness/readiness check for deployment orchestration (load balancers,
 * container health checks). Deliberately reveals nothing about internal
 * infrastructure — no hostnames, connection strings, or versions — on
 * either success or failure. See docs/deployment.md.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch {
    return NextResponse.json(
      { status: "unavailable", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
