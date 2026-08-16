import type { Content } from "pdfmake/interfaces";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { pdf } from "@/lib/report-response";
import { buildSheet, dataTable, miniTable, sheetTitle, signatureLine, KPLC_GREEN, KPLC_NAVY } from "@/lib/pdf";
import { APPROVAL_ACTION_META, isApprovalAction } from "@/lib/approvals";
import { ROLE_LABELS, formatRating } from "@/lib/format";

/**
 * The bulk summary: one sheet listing everything decided in a single sitting.
 *
 * This does NOT replace the individual certificates. Each transformer still
 * gets its own, because a certificate is what travels with the unit — it goes
 * in the folder that follows that asset for thirty years, and a shared sheet
 * naming forty other transformers is useless in that folder.
 *
 * What this is for is the other half of the filing: the manager's own record
 * that on this morning, they released these forty units, and the store's proof
 * of what arrived under one authority. One signature covering a named list is
 * a normal utility document. It is not a shortcut around the individual ones.
 *
 * `?ids=a,b,c` — explicitly the set the manager just decided, not "everything
 * approved today". Two managers working the same queue would otherwise each
 * print a sheet claiming the other's work.
 */

const dt = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const tm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export async function GET(request: Request) {
  try {
    const viewer = await requireApiUser();
    const url = new URL(request.url);
    const ids = (url.searchParams.get("ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 300);

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "No approvals named. Add ?ids=… to say which ones this sheet covers." },
        { status: 422 },
      );
    }

    const docs = await prisma.approvalDocument.findMany({
      where: { id: { in: ids } },
      orderBy: { decidedAt: "asc" },
      include: {
        transformer: {
          select: {
            gNumber: true,
            serialNumber: true,
            ratingKva: true,
            manufacturer: { select: { name: true } },
            currentStore: { select: { name: true } },
          },
        },
        requestedBy: { select: { name: true } },
        decidedBy: { select: { name: true, role: true, staffNumber: true } },
      },
    });

    if (docs.length === 0) {
      return NextResponse.json({ error: "None of those approvals exist." }, { status: 404 });
    }

    const approved = docs.filter((d) => d.status === "APPROVED");
    const refused = docs.filter((d) => d.status === "REJECTED");
    const pending = docs.filter((d) => d.status === "PENDING");

    // The signatory is whoever decided them. If the batch was decided by more
    // than one person — which happens when a manager prints a sheet covering
    // somebody else's decisions too — the sheet says so rather than putting one
    // name against work they did not do.
    const signatories = [
      ...new Map(
        docs.filter((d) => d.decidedBy).map((d) => [d.decidedById, d.decidedBy!]),
      ).values(),
    ];
    const soleSignatory = signatories.length === 1 ? signatories[0] : null;

    const decidedAt = docs.map((d) => d.decidedAt).filter(Boolean) as Date[];
    const when = decidedAt.length
      ? new Date(Math.max(...decidedAt.map((d) => d.getTime())))
      : new Date();

    const content: Content[] = [];

    content.push({
      margin: [0, 12, 0, 0],
      fontSize: 9.5,
      text: [
        { text: "This schedule records " },
        { text: `${docs.length} approval decision${docs.length === 1 ? "" : "s"}`, bold: true },
        {
          text:
            " taken together. An individual certificate has been issued for each transformer listed " +
            "below and travels with that unit; this sheet is the covering record.",
        },
      ],
    });

    content.push(sheetTitle("Summary"));
    content.push({
      columns: [
        {
          width: "*",
          stack: [
            miniTable([
              ["Approved", approved.length],
              ["Refused", refused.length],
              ["Still pending", pending.length],
            ]),
          ],
        },
        {
          width: "*",
          stack: [
            miniTable([
              ["Signed by", soleSignatory?.name ?? (signatories.length ? `${signatories.length} people` : "—")],
              ["Position", soleSignatory ? ROLE_LABELS[soleSignatory.role] : "—"],
              ["Staff no.", soleSignatory?.staffNumber ?? "—"],
            ]),
          ],
        },
      ],
      columnGap: 14,
    });

    if (signatories.length > 1) {
      content.push({
        text:
          "More than one person decided the items on this sheet. Each certificate names its own " +
          "signatory; this schedule does not attribute them all to one person.",
        style: "muted",
        margin: [0, 5, 0, 0],
      });
    }

    content.push(sheetTitle("Schedule of decisions"));
    content.push(
      dataTable(
        ["Reference", "G-Number / Serial", "Rating", "Approved for", "Decision", "Raised by"],
        docs.map((d) => [
          d.reference,
          d.transformer.gNumber ?? d.transformer.serialNumber,
          formatRating(d.transformer.ratingKva),
          isApprovalAction(d.action) ? APPROVAL_ACTION_META[d.action].label : d.action,
          d.status === "APPROVED" ? "APPROVED" : d.status === "REJECTED" ? "REFUSED" : "PENDING",
          d.requestedBy.name,
        ]),
        [66, "*", 44, 84, 50, 66],
        (row) =>
          row[4] === "APPROVED" ? "#eafaf1" : row[4] === "REFUSED" ? "#fdeeee" : "#fff9e6",
      ),
    );

    const emergencies = docs.filter((d) => d.emergency);
    if (emergencies.length > 0) {
      content.push({
        margin: [0, 10, 0, 0],
        table: {
          widths: ["*"],
          body: [[
            {
              text:
                `${emergencies.length} of these were EMERGENCY authorisations — the work was carried out ` +
                "first to restore supply and is being ratified after the fact. They are listed as " +
                `${emergencies.map((e) => e.reference).join(", ")}.`,
              fontSize: 8,
              bold: true,
              color: "#7c2d12",
              fillColor: "#fef3c7",
              margin: [9, 6, 9, 6],
            },
          ]],
        },
        layout: "noBorders",
      });
    }

    content.push({
      margin: [0, 6, 0, 0],
      columns: [
        signatureLine(
          soleSignatory
            ? `${soleSignatory.name} · ${ROLE_LABELS[soleSignatory.role]}`
            : "Authorising officer",
          200,
        ),
        signatureLine("Date · Official stamp", 200),
      ],
      columnGap: 24,
    });

    content.push({
      margin: [0, 14, 0, 0],
      table: {
        widths: ["*"],
        body: [[
          {
            stack: [
              { text: "HOW TO CHECK THIS SHEET", fontSize: 7.5, bold: true, color: KPLC_GREEN, characterSpacing: 0.5 },
              {
                text:
                  "Every reference above resolves to an individual certificate inside Transformer DNA, " +
                  "and each of those resolves in turn to a position in the asset's hash-linked history. " +
                  "A reference that does not resolve was not issued by this system.",
                fontSize: 7,
                color: "#5b6480",
                margin: [0, 3, 0, 0],
              },
            ],
            fillColor: "#f7f8fa",
            margin: [9, 6, 9, 6],
          },
        ]],
      },
      layout: "noBorders",
    });

    content.push({
      text: `Printed by ${viewer.name} (${ROLE_LABELS[viewer.role]}) on ${dt(new Date())} at ${tm(new Date())}.`,
      style: "muted",
      margin: [0, 7, 0, 0],
    });

    const buffer = await buildSheet({
      documentType: "SCHEDULE OF APPROVALS",
      reference: `${docs[0].reference} + ${docs.length - 1} more`,
      statusText: `${approved.length} APPROVED · ${refused.length} REFUSED`,
      statusFill: refused.length ? "#fef3c7" : "#d1fae5",
      statusColor: refused.length ? "#92400e" : "#065f46",
      content,
    });

    return pdf(buffer, `approval-schedule-${dt(when).replace(/ /g, "-")}`);
  } catch (error) {
    return apiError(error);
  }
}
