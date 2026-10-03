import { NextResponse } from "next/server";
import { finalizeJob } from "../../../../../crawler/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ jobId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { jobId } = await ctx.params;
  try {
    const job = await finalizeJob(jobId);
    return NextResponse.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to finalize job";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
