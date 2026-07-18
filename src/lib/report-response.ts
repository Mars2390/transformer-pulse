import { NextResponse } from "next/server";
import { attachment } from "./reports";

/** Shared HTTP responses for report downloads. Kept out of route files, which
 * may only export HTTP handlers. */

export function csv(body: string, name: string): NextResponse {
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachment(name, "csv"),
    },
  });
}

export function xlsx(buffer: Uint8Array<ArrayBuffer>, name: string): NextResponse {
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachment(name, "xlsx"),
    },
  });
}

export function pdf(buffer: Uint8Array<ArrayBuffer>, name: string): NextResponse {
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": attachment(name, "pdf"),
    },
  });
}
