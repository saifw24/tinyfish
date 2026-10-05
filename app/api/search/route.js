import { NextResponse } from "next/server";
import { resolvePlace, placeId } from "@/lib/stations";
import { startJob } from "@/lib/pipeline";

export async function POST(req) {
  const b = await req.json().catch(() => ({}));
  const from = resolvePlace(b.from), to = resolvePlace(b.to);
  if (!from || !to) return NextResponse.json({ error: "Pick origin and destination from the list." }, { status: 400 });
  if (placeId(from) === placeId(to)) return NextResponse.json({ error: "Origin and destination are the same." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || "")) return NextResponse.json({ error: "Enter a travel date." }, { status: 400 });
  if (!/^\d{2}:\d{2}$/.test(b.time || "")) return NextResponse.json({ error: "Enter a preferred departure time." }, { status: 400 });
  const flex = [30, 60, 120, 180].includes(Number(b.flexMinutes)) ? Number(b.flexMinutes) : 120;
  const input = {
    from, to,
    date: b.date, time: b.time, flexMinutes: flex,
    railcard: ["none", "16-25", "26-30", "other"].includes(b.railcard) ? b.railcard : "none",
    maxChanges: Math.min(3, Math.max(0, Number(b.maxChanges) || 0)),
    split: !!b.split,
    warm: !!b.warm,
    target: Number(b.target) > 0 ? Number(b.target) : 0,
  };
  return NextResponse.json({ id: startJob(input) });
}
