import type { Content } from "pdfmake/interfaces";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { pdf } from "@/lib/report-response";
import {
  buildSheet,
  miniTable,
  sheetTitle,
  signatureLine,
  tickList,
  KPLC_GREEN,
  KPLC_NAVY,
} from "@/lib/pdf";
import { qrDataUrl, siteUrl, transformerQrUrl } from "@/lib/qr";
import {
  APPROVAL_ACTIONS,
  APPROVAL_ACTION_META,
  isApprovalAction,
  type ApprovalAction,
} from "@/lib/approvals";
import { ROLE_LABELS, formatRating } from "@/lib/format";

/**
 * The approval document, in whichever of its two faces currently applies.
 *
 * ONE ROUTE, NOT TWO. A PENDING record renders REQUEST FOR APPROVAL; a decided
 * one renders APPROVAL CERTIFICATE. They carry the same reference number
 * because they are the same piece of paperwork at two moments in its life,
 * which is how a utility files them — the request and the authority that
 * answered it, stapled together under one number. Two routes would have meant
 * two sequences and an obvious question at audit: which request does this
 * certificate answer?
 *
 * IT FITS ON ONE SHEET, DELIBERATELY. The requester and the signatory sit side
 * by side rather than stacked, because that is both how the paper form reads
 * and what keeps the signature block off a second page. A two-page approval
 * whose second page holds nothing but a signature is a page that gets
 * separated from the first one in a filing cabinet.
 *
 * The document is not the authority. It records what the system holds. The
 * tamper-evident chain is the proof, which is why the chain reference is
 * printed at the foot: a certificate whose hash does not resolve in the app
 * was not issued by this system, whatever it appears to say.
 */

const dt = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const tm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireApiUser();
    const { id } = await params;

    const doc = await prisma.approvalDocument.findUnique({
      where: { id },
      include: {
        transformer: {
          select: {
            id: true,
            gNumber: true,
            serialNumber: true,
            ratingKva: true,
            primaryKv: true,
            secondaryKv: true,
            yearOfManufacture: true,
            status: true,
            currentSiteName: true,
            region: true,
            county: true,
            manufacturer: { select: { name: true } },
            currentStore: { select: { name: true, code: true } },
          },
        },
        requestedBy: { select: { name: true, role: true, staffNumber: true } },
        decidedBy: { select: { name: true, role: true, staffNumber: true } },
      },
    });

    if (!doc) {
      return NextResponse.json({ error: "No such approval document." }, { status: 404 });
    }
    if (!isApprovalAction(doc.action)) {
      return NextResponse.json({ error: "This document names an unknown action." }, { status: 422 });
    }

    const action = doc.action as ApprovalAction;
    const meta = APPROVAL_ACTION_META[action];
    const tx = doc.transformer;
    const label = tx.gNumber ?? tx.serialNumber;
    const approved = doc.status === "APPROVED";
    const rejected = doc.status === "REJECTED";
    const pending = doc.status === "PENDING";

    // The QR resolves to the unit's record, so somebody holding a photocopy can
    // check it against the live system without typing a G-Number off the page.
    const qr = await qrDataUrl(transformerQrUrl(siteUrl(), tx.gNumber, tx.id), 150).catch(
      () => null,
    );

    const content: Content[] = [];

    // --- The sentence a certificate has to open with -----------------------
    content.push({
      margin: [0, 12, 0, 0],
      text: approved
        ? [
            { text: "This is to certify that the transformer described below has been " },
            { text: "APPROVED", bold: true, color: KPLC_GREEN },
            { text: ` for ${meta.certificateLine.toLowerCase()}.` },
          ]
        : rejected
          ? [
              { text: "This is to record that approval for " },
              { text: meta.certificateLine.toLowerCase(), bold: true },
              { text: " on the transformer described below was " },
              { text: "REFUSED", bold: true, color: "#991b1b" },
              { text: "." },
            ]
          : [
              { text: "Approval is hereby requested for " },
              { text: meta.certificateLine.toLowerCase(), bold: true },
              { text: " on the transformer described below." },
            ],
      fontSize: 9.5,
    });

    // --- The asset ---------------------------------------------------------
    content.push(sheetTitle("Transformer"));
    content.push({
      columns: [
        {
          width: "*",
          stack: [
            miniTable([
              ["G-Number", tx.gNumber ?? "Not yet issued"],
              ["Serial", tx.serialNumber],
              ["Maker", tx.manufacturer.name],
              ["Rating", `${formatRating(tx.ratingKva)} · ${tx.primaryKv}/${tx.secondaryKv} kV`],
            ]),
          ],
        },
        {
          width: "*",
          stack: [
            miniTable([
              ["Year", tx.yearOfManufacture],
              ["Status", tx.status.replace(/_/g, " ")],
              ["Held at", tx.currentStore ? `${tx.currentStore.name} (${tx.currentStore.code})` : (tx.currentSiteName ?? "—")],
              ["Region", [tx.region, tx.county].filter(Boolean).join(" · ") || "—"],
            ]),
          ],
        },
      ],
      columnGap: 14,
    });

    // --- The checklist -----------------------------------------------------
    content.push(
      sheetTitle(
        approved
          ? "Has been approved for"
          : rejected
            ? "Approval was requested for"
            : "Approval is requested for",
      ),
    );
    content.push(
      tickList(
        APPROVAL_ACTIONS.map((a) => ({
          label: APPROVAL_ACTION_META[a].certificateLine,
          ticked: a === action,
        })),
      ),
    );
    content.push({ text: meta.description, style: "muted", margin: [0, 5, 0, 0] });

    if (doc.contextLabel) {
      content.push({
        text: `Destination / context at the time of request: ${doc.contextLabel}`,
        fontSize: 8.5,
        color: KPLC_NAVY,
        margin: [0, 3, 0, 0],
      });
    }

    // An emergency approval says so on its face, in a box. The only reason the
    // emergency path is tolerable at all is that it is visible afterwards; a
    // flag only a database query can find is not a control.
    if (doc.emergency) {
      content.push({
        margin: [0, 9, 0, 0],
        table: {
          widths: ["*"],
          body: [[
            {
              text:
                "EMERGENCY AUTHORISATION — the work was carried out first to restore supply, and this " +
                "approval was raised by the system on the engineer's behalf for ratification afterwards. " +
                "The signatory below is confirming work that has already happened.",
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

    // --- Requester and signatory, side by side ------------------------------
    content.push({
      margin: [0, 11, 0, 0],
      columns: [
        {
          width: "*",
          stack: [
            { text: "REQUESTED BY", fontSize: 8.5, bold: true, color: KPLC_GREEN, characterSpacing: 0.6, margin: [0, 0, 0, 4] },
            miniTable([
              ["Name", doc.requestedBy.name],
              ["Position", ROLE_LABELS[doc.requestedBy.role]],
              ["Staff no.", doc.requestedBy.staffNumber ?? "Not recorded"],
              ["Date", dt(doc.requestedAt)],
              ["Time", tm(doc.requestedAt)],
            ]),
          ],
        },
        {
          width: "*",
          stack: [
            {
              text: approved ? "APPROVED BY" : rejected ? "REFUSED BY" : "TO BE APPROVED BY",
              fontSize: 8.5,
              bold: true,
              color: approved || rejected ? KPLC_GREEN : "#92400e",
              characterSpacing: 0.6,
              margin: [0, 0, 0, 4],
            },
            approved || rejected
              ? miniTable([
                  ["Name", doc.decidedBy?.name ?? "—"],
                  ["Position", doc.decidedBy ? ROLE_LABELS[doc.decidedBy.role] : "—"],
                  ["Staff no.", doc.decidedBy?.staffNumber ?? "Not recorded"],
                  ["Date", doc.decidedAt ? dt(doc.decidedAt) : "—"],
                  ["Time", doc.decidedAt ? tm(doc.decidedAt) : "—"],
                ])
              : miniTable([
                  ["Name", null],
                  ["Position", meta.approvers.map((r) => ROLE_LABELS[r]).join(" / ")],
                  ["Staff no.", null],
                  ["Date", null],
                  ["Time", null],
                ]),
          ],
        },
      ],
      columnGap: 14,
    });

    if (doc.justification) {
      content.push({
        margin: [0, 8, 0, 0],
        text: [
          { text: "Reason given: ", bold: true, fontSize: 8.5, color: KPLC_NAVY },
          { text: doc.justification, fontSize: 8.5 },
        ],
      });
    }
    if (doc.decisionNotes) {
      content.push({
        margin: [0, 4, 0, 0],
        text: [
          {
            text: rejected ? "Reason for refusal: " : "Remarks: ",
            bold: true,
            fontSize: 8.5,
            color: rejected ? "#991b1b" : KPLC_NAVY,
          },
          { text: doc.decisionNotes, fontSize: 8.5 },
        ],
      });
    }

    if (pending) {
      content.push({
        margin: [0, 9, 0, 0],
        text:
          "This document is evidence that the request was raised, and when. It is NOT authority to " +
          "carry out the work. Once a decision is recorded, a certificate carrying this same " +
          "reference number is issued and supersedes this sheet.",
        fontSize: 8.5,
        bold: true,
        color: "#92400e",
      });
    }

    // --- Signatures ---------------------------------------------------------
    content.push({
      margin: [0, 2, 0, 0],
      columns: [
        signatureLine(
          approved || rejected
            ? `${doc.decidedBy?.name ?? ""} · ${doc.decidedBy ? ROLE_LABELS[doc.decidedBy.role] : ""}`
            : `${doc.requestedBy.name} · ${ROLE_LABELS[doc.requestedBy.role]} (requester)`,
          200,
        ),
        signatureLine(approved || rejected ? "Date · Official stamp" : "Received by · Date", 200),
      ],
      columnGap: 24,
    });

    // --- Chain reference ----------------------------------------------------
    content.push({
      margin: [0, 14, 0, 0],
      table: {
        widths: ["*"],
        body: [[
          {
            stack: [
              { text: "CUSTODY CHAIN REFERENCE", fontSize: 7.5, bold: true, color: KPLC_GREEN, characterSpacing: 0.5 },
              {
                text: doc.chainHash
                  ? doc.chainHash.slice(0, 24).toUpperCase()
                  : approved
                    ? "Not yet acted on. A chain entry is written the moment the work is recorded, and this document then resolves to it."
                    : "No chain entry — nothing has happened to the asset as a result of this document.",
                fontSize: doc.chainHash ? 9.5 : 7.5,
                bold: Boolean(doc.chainHash),
                color: doc.chainHash ? KPLC_NAVY : "#5b6480",
                margin: [0, 2, 0, 0],
              },
              {
                text:
                  "Each entry in this asset's history is hash-linked to the one before it. A certificate " +
                  "whose reference does not resolve inside Transformer DNA was not issued by this system, " +
                  "whatever it appears to say.",
                fontSize: 7,
                color: "#5b6480",
                margin: [0, 4, 0, 0],
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
      text: `Printed by ${viewer.name} (${ROLE_LABELS[viewer.role]}) on ${dt(new Date())} at ${tm(new Date())}. Reference ${doc.reference}.`,
      style: "muted",
      margin: [0, 7, 0, 0],
    });

    const buffer = await buildSheet({
      documentType: pending ? "REQUEST FOR APPROVAL" : "APPROVAL CERTIFICATE",
      reference: doc.reference,
      statusText: approved
        ? "APPROVED"
        : rejected
          ? "REFUSED"
          : pending
            ? "PENDING APPROVAL"
            : doc.status,
      statusFill: approved ? "#d1fae5" : rejected ? "#fee2e2" : "#fef3c7",
      statusColor: approved ? "#065f46" : rejected ? "#991b1b" : "#92400e",
      qrDataUri: qr,
      content,
    });

    return pdf(buffer, `${doc.reference}-${label}`);
  } catch (error) {
    return apiError(error);
  }
}
