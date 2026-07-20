import { NextResponse } from "next/server";
import { readJob } from "../../../../../lib/jobs";
import { zipJobFolder } from "../../../../../lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ jobId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { jobId } = await ctx.params;
  const meta = await readJob(jobId);
  if (!meta) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  try {
    const buf = await zipJobFolder(jobId);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="webscrapper-${jobId.slice(0, 8)}.zip"`,
        "Content-Length": String(buf.length),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ZIP failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
