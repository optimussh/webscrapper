import { NextResponse } from "next/server";
import { continueJob } from "../../../../../lib/jobs";
import { spawnCrawlJob } from "../../../../../lib/spawn-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ jobId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { jobId } = await ctx.params;
  try {
    const body = (await req.json()) as { maxPages?: number; maxDepth?: number };
    const job = await continueJob(jobId, {
      maxPages: Number(body?.maxPages),
      maxDepth: body?.maxDepth == null ? undefined : Number(body.maxDepth),
    });
    spawnCrawlJob(job.id);
    return NextResponse.json({ job });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to continue job";
    const status = message === "Job not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
