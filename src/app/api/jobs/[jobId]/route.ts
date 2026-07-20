import { NextResponse } from "next/server";
import { loadJobArtifacts } from "../../../../lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { jobId } = await ctx.params;
  try {
    const artifacts = await loadJobArtifacts(jobId);
    return NextResponse.json(artifacts);
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
}
