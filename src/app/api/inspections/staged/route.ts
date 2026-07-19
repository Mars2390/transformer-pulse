import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { loadStagedUnits } from "@/lib/inspection-promote";

/** GET /api/inspections/staged — inspections with no transformer to attach to. */
export async function GET() {
  try {
    await requireApiRole("ADMIN", "MANAGER");
    const units = await loadStagedUnits();

    return NextResponse.json({
      units: units.map((u) => ({
        key: u.key,
        gNumber: u.gNumber,
        serial: u.serial,
        substationCode: u.substationCode,
        substationName: u.substationName,
        make: u.make,
        ratingKva: u.ratingKva,
        yom: u.yom,
        region: u.region,
        locationNote: u.locationNote,
        lastInspectedOn: u.lastInspectedOn.toISOString().slice(0, 10),
        inspectorRef: u.inspectorRef,
        structure: u.structure,
        visits: u.visits,
        blockers: u.blockers,
        warnings: u.warnings,
      })),
      totals: {
        total: units.length,
        promotable: units.filter((u) => !u.blockers.length).length,
        blocked: units.filter((u) => u.blockers.length).length,
        withGNumber: units.filter((u) => u.gNumber).length,
        withSerial: units.filter((u) => u.serial).length,
        withWarnings: units.filter((u) => u.warnings.length).length,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
