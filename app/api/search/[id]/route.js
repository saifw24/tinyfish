import { NextResponse } from "next/server";
import { jobs } from "@/lib/pipeline";

export async function GET(_req, { params }) {
  const { id } = await params;
  const j = jobs.get(id);
  if (!j) return NextResponse.json({ error: "Unknown search" }, { status: 404 });
  return NextResponse.json({ stage: j.stage, error: j.error, discovered: j.discovered, result: j.result, partial: j.partial, splitPending: j.splitPending });
}
