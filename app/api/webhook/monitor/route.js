import { NextResponse } from "next/server";
import { checkWatch } from "@/lib/watch";
import { getWatch } from "@/lib/store";
import { loadEnv } from "@/lib/tinyfish";

// TinyFish Monitor calls this on its schedule; we then verify real fares and evaluate the user's condition.
export async function POST(req) {
  loadEnv();
  const u = new URL(req.url);
  if (u.searchParams.get("secret") !== (process.env.WEBHOOK_SECRET || "")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = u.searchParams.get("watch");
  if (!getWatch(id)) return NextResponse.json({ error: "unknown watch" }, { status: 404 });
  checkWatch(id).catch(() => {});
  return NextResponse.json({ accepted: true });
}
