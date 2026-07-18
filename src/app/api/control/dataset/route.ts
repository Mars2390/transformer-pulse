import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";

/** GET /api/control/dataset — the active dataset the control room replays. */
export async function GET() {
  try {
    await requireApiRole("ADMIN", "MANAGER");

    const dataset = await prisma.meterDataset.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    });
    if (!dataset) return NextResponse.json({ dataset: null });

    // The wall-clock label for each interval, so the UI can show "19:15".
    const stamps = await prisma.meterReading.findMany({
      where: { datasetId: dataset.id },
      distinct: ["intervalIndex"],
      orderBy: { intervalIndex: "asc" },
      select: { intervalIndex: true, timestamp: true },
    });

    return NextResponse.json({
      dataset: {
        id: dataset.id,
        name: dataset.name,
        transformerRef: dataset.transformerRef,
        ratingKva: dataset.ratingKva,
        meterCount: dataset.meterCount,
        intervalCount: dataset.intervalCount,
        batchSize: dataset.batchSize,
        uploadedByName: dataset.uploadedByName,
        createdAtISO: dataset.createdAt.toISOString(),
        intervalLabels: stamps.map((s) =>
          s.timestamp.toISOString().slice(11, 16),
        ),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
