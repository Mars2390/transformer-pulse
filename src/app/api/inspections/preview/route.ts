import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { previewInspections } from "@/lib/inspection-import";

/**
 * POST /api/inspections/preview — read the register, change nothing.
 *
 * Nothing commits without this step. A register carries pole conditions and
 * earth readings for a thousand real assets; the operator gets to see what will
 * happen to each row before any of it is written.
 */

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    await requireApiRole("ADMIN", "MANAGER");

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "That file is over 25 MB." }, { status: 413 });
    }
    const name = file.name.toLowerCase();
    if (!/\.(csv|xlsx|xls)$/.test(name)) {
      return NextResponse.json({ error: "Upload a .csv, .xlsx or .xls file." }, { status: 415 });
    }

    const result = await previewInspections(await file.arrayBuffer(), file.name);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && /inspection register|no data rows/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return apiError(error);
  }
}
