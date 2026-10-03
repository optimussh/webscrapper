import { NextResponse } from "next/server";
import { createJob, listJobs } from "../../../lib/jobs";
import { spawnCrawlJob } from "../../../lib/spawn-job";
import type { CreateJobInput, SiteType } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE_TYPES: SiteType[] = ["static", "dynamic", "list-detail"];

export async function GET() {
  const jobs = await listJobs();
  return NextResponse.json({ jobs });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateJobInput;

    if (!body?.startUrl || typeof body.startUrl !== "string") {
      return NextResponse.json({ error: "startUrl is required" }, { status: 400 });
    }
    if (!SITE_TYPES.includes(body.siteType)) {
      return NextResponse.json(
        { error: "siteType must be static | dynamic | list-detail" },
        { status: 400 },
      );
    }

    const job = await createJob({
      startUrl: body.startUrl.trim(),
      siteType: body.siteType,
      features: {
        structure: body.features?.structure ?? true,
        extract: body.features?.extract ?? false,
        archive: body.features?.archive ?? true,
        paymentCapture: body.features?.paymentCapture ?? false,
        markdown: body.features?.markdown ?? false,
        screenshot: body.features?.screenshot ?? false,
        polite: body.features?.polite ?? false,
        sitemapSeed: body.features?.sitemapSeed ?? false,
        smartExtract: body.features?.smartExtract ?? false,
        wgetMirror: body.features?.wgetMirror ?? false,
      },
      extractors: body.extractors,
      limits: body.limits,
      listLinkSelector: body.listLinkSelector,
      detailUrlIncludes: body.detailUrlIncludes,
      listItemSelector: body.listItemSelector,
      scope: body.scope ?? "site",
    });

    spawnCrawlJob(job.id);

    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create job";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
