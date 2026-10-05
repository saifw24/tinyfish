import { NextResponse } from "next/server";
import { allWatches } from "@/lib/store";
import { createWatch, publicWatch } from "@/lib/watch";

export async function GET() { return NextResponse.json({ watches: allWatches().map(publicWatch) }); }

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  const c = b.condition || {};
  const condition = c.type === "price_below" && c.value > 0
    ? { type: "price_below", value: Number(c.value) }
    : c.type === "saving_within" && c.saving > 0
      ? { type: "saving_within", saving: Number(c.saving), withinMinutes: Number(c.withinMinutes) || 60 }
      : null;
  if (!condition || !b.input?.from?.name || !b.sources?.length) return NextResponse.json({ error: "Invalid watch request." }, { status: 400 });
  try {
    const w = await createWatch({ input: b.input, condition, email: b.email, sources: b.sources, baselinePrice: b.baselinePrice, bestPrice: b.bestPrice });
    return NextResponse.json({ watch: publicWatch(w) });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 502 }); }
}
