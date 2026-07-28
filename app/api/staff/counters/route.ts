import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const counters = await prisma.counter.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ counters: counters.map((c) => ({ id: c.id, slug: c.slug, name: c.name })) });
}