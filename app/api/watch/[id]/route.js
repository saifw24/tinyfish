import { NextResponse } from "next/server";
import { checkWatch, deleteWatch, publicWatch } from "@/lib/watch";
import { getWatch } from "@/lib/store";

export async function POST(_req, { params }) {
  const { id } = await params;
  if (!getWatch(id)) return NextResponse.json({ error: "Unknown watch" }, { status: 404 });
  const w = await checkWatch(id);
  return NextResponse.json({ watch: publicWatch(w) });
}
export async function DELETE(_req, { params }) {
  const { id } = await params;
  await deleteWatch(id);
  return NextResponse.json({ ok: true });
}
