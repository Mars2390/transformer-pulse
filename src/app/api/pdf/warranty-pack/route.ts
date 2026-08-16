import type { Content } from "pdfmake/interfaces";
import { prisma } from "@/lib/prisma";
import { requireApiRole } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { pdf } from "@/lib/report-response";
import { buildPdf, dataTable, detailTable, sectionTitle, embedPhotos, KPLC_NAVY } from "@/lib/pdf";
import { verifyChain, type ChainLink } from "@/lib/chain";
import { computeWarranty } from "@/lib/warranty";
import { dmy, gps } from "@/lib/report-data";
import { EVENT_META, ROLE_LABELS, formatKes } from "@/lib/format";
import { regionWhere } from "@/lib/region-scope";

/**
 * GET /api/pdf/warranty-pack[?manufacturerId=...]
 *
 * The claim submission sent to a manufacturer: a cover letter, one page per
 * claim carrying that transformer's full history and chain proof, and a summary
 * table. Written to be read by someone who does not work for KPLC.
 */
export async function GET(request: Request) {
  try {
    const user = await requireApiRole("MANAGER", "ADMIN");
    const manufacturerId = new URL(request.url).searchParams.get("manufacturerId");
    const scope = regionWhere(user.region, user.role);

    const claims = await prisma.warrantyClaim.findMany({
      where: {
        transformer: scope,
        status: { in: ["OPEN", "SUBMITTED", "APPROVED"] },
        ...(manufacturerId ? { manufacturerId } : {}),
      },
      orderBy: [{ manufacturerId: "asc" }, { createdAt: "desc" }],
      include: {
        manufacturer: true,
        transformer: {
          include: {
            events: { orderBy: { occurredAt: "asc" }, include: { user: { select: { name: true } } } },
          },
        },
      },
    });

    const makers = [...new Set(claims.map((c) => c.manufacturer.name))];
    const addressee = makers.length === 1 ? makers[0] : "All manufacturers";
    const total = claims.reduce((s, c) => s + Number(c.claimValueKes ?? 0), 0);
    const reference = `KPLC/TP/${new Date().getFullYear()}/${String(claims.length).padStart(3, "0")}`;

    const content: Content[] = [];

    // --- Cover letter -------------------------------------------------------
    content.push({ text: "Warranty Claim Submission", style: "section", margin: [0, 0, 0, 4] });
    content.push({ text: `Reference: ${reference}`, style: "muted", margin: [0, 0, 0, 16] });
    content.push({
      columns: [
        { width: "*", stack: [
          { text: "TO", fontSize: 7, bold: true, color: "#5b6480" },
          { text: addressee, fontSize: 11, bold: true, color: KPLC_NAVY },
          ...(makers.length === 1 && claims[0]?.manufacturer.contactName
            ? [{ text: claims[0].manufacturer.contactName, fontSize: 9 }] : []),
          ...(makers.length === 1 && claims[0]?.manufacturer.contactEmail
            ? [{ text: claims[0].manufacturer.contactEmail, fontSize: 9 }] : []),
        ]},
        { width: "*", stack: [
          { text: "FROM", fontSize: 7, bold: true, color: "#5b6480" },
          { text: "Kenya Power — Transformer DNA", fontSize: 11, bold: true, color: KPLC_NAVY },
          { text: `${user.name} (${ROLE_LABELS[user.role]})`, fontSize: 9 },
          { text: user.region ?? "All regions", fontSize: 9 },
          { text: new Date().toLocaleDateString("en-GB"), fontSize: 9 },
        ]},
      ],
      margin: [0, 0, 0, 18],
    });

    content.push({
      text: `This document contains ${claims.length} warranty claim${claims.length === 1 ? "" : "s"} totalling ${formatKes(total)}.`,
      fontSize: 10, bold: true, margin: [0, 0, 0, 10],
    });
    content.push({
      text: "Each claim below is accompanied by the complete, unedited history of the transformer concerned. Every event in that history stores a SHA-256 hash computed from the previous event and its own contents, so any later alteration to a past record changes every hash that follows it and cannot be concealed. The verification result for each unit is stated on its page.",
      fontSize: 9, margin: [0, 0, 0, 14],
    });

    content.push(dataTable(
      ["Claim", "G-Number", "Manufacturer", "Fault date", "Value (KES)", "Status"],
      claims.map((c) => [
        c.id.slice(-8).toUpperCase(),
        c.transformer.gNumber ?? c.transformer.serialNumber,
        c.manufacturer.name, dmy(c.createdAt),
        c.claimValueKes ? formatKes(Number(c.claimValueKes)) : "—", c.status,
      ]),
      ["auto", "auto", "*", "auto", "auto", "auto"],
    ));

    // --- One page per claim -------------------------------------------------
    for (const c of claims) {
      const tx = c.transformer;
      const chain = verifyChain(tx.events as unknown as ChainLink[]);
      const atFault = computeWarranty(tx.warrantyStart, tx.warrantyMonths, c.createdAt);
      const faultEvent = [...tx.events].reverse().find((e) => e.type === "FAULT_REPORTED");

      content.push({ text: "", pageBreak: "before" });
      content.push(sectionTitle(`Claim ${c.id.slice(-8).toUpperCase()} — ${tx.gNumber ?? tx.serialNumber}`));

      content.push(detailTable([
        ["G-Number", tx.gNumber],
        ["Serial number", tx.serialNumber],
        ["Manufacturer", c.manufacturer.name],
        ["Rating", `${tx.ratingKva} kVA`],
        ["Voltage", `${tx.primaryKv} / ${tx.secondaryKv} kV`],
        ["Year of manufacture", tx.yearOfManufacture],
        ["Location at fault", tx.currentSiteName],
        ["GPS", tx.currentLat != null ? `${gps(tx.currentLat)}, ${gps(tx.currentLng)}` : null],
        ["Installed", dmy(tx.commissionDate)],
        ["Fault date", dmy(c.createdAt)],
        ["Days in service before fault", tx.commissionDate ? String(Math.max(0, Math.round((c.createdAt.getTime() - tx.commissionDate.getTime()) / 86_400_000))) : null],
        ["Warranty start", dmy(tx.warrantyStart)],
        ["Warranty expiry", dmy(computeWarranty(tx.warrantyStart, tx.warrantyMonths).expiresAt)],
        ["Days of warranty remaining at fault", atFault.daysRemaining != null ? String(atFault.daysRemaining) : null],
        ["Fault cause", c.faultReason],
        ["Claim value", c.claimValueKes ? formatKes(Number(c.claimValueKes)) : null],
        ["Claim status", c.status],
        ["RMA reference", c.referenceNo],
      ]));

      content.push({ text: "Complete history", style: "h2", margin: [0, 14, 0, 6] });
      content.push(dataTable(
        ["Date", "Event", "By", "Detail", "Hash"],
        tx.events.map((e) => [
          dmy(e.occurredAt), EVENT_META[e.type].label, e.user.name,
          e.notes ?? "", `…${e.hash.slice(-8)}`,
        ]),
        ["auto", "auto", "auto", "*", "auto"],
      ));

      content.push({
        margin: [0, 10, 0, 0],
        table: { widths: ["*"], body: [[{
          text: chain.valid
            ? `Chain verified: ${chain.checked} events, unbroken. This history has not been altered.`
            : `CHAIN BROKEN: ${chain.reason ?? "hash mismatch"}.`,
          bold: true, fontSize: 9,
          color: chain.valid ? "#065f46" : "#991b1b",
          fillColor: chain.valid ? "#d1fae5" : "#fee2e2",
          margin: [10, 7, 10, 7],
        }]] },
        layout: "noBorders",
      });

      // Photographs of the fault, where the engineer took them.
      if (faultEvent?.photoUrls.length) {
        const imgs = await embedPhotos(faultEvent.photoUrls, 4);
        if (imgs.length) {
          content.push({ text: "Photographs of the fault", style: "h2", margin: [0, 14, 0, 6] });
          for (let i = 0; i < imgs.length; i += 2) {
            // The image is wrapped in a stack: a column width may sit on a
            // stack, but ContentImage.width means the image's own pixel width.
            content.push({
              columns: imgs.slice(i, i + 2).map((p) => ({
                width: "50%" as const,
                stack: [{ image: p.data, fit: [230, 165] as [number, number] }],
              })),
              columnGap: 12, margin: [0, 0, 0, 10], unbreakable: true,
            });
          }
        }
      }
    }

    // --- Closing summary ----------------------------------------------------
    content.push({ text: "", pageBreak: "before" });
    content.push(sectionTitle("Summary of claims"));
    content.push(dataTable(
      ["Claim", "G-Number", "Serial", "Fault date", "Value (KES)", "Chain"],
      claims.map((c) => [
        c.id.slice(-8).toUpperCase(), c.transformer.gNumber ?? "—", c.transformer.serialNumber,
        dmy(c.createdAt), c.claimValueKes ? formatKes(Number(c.claimValueKes)) : "—",
        verifyChain(c.transformer.events as unknown as ChainLink[]).valid ? "Verified" : "BROKEN",
      ]),
      ["auto", "auto", "auto", "auto", "auto", "auto"],
    ));
    content.push({
      text: `Total claimed: ${formatKes(total)}`,
      fontSize: 12, bold: true, color: KPLC_NAVY, margin: [0, 14, 0, 14],
    });
    content.push({
      text: `For questions regarding this submission, contact ${user.name}, ${ROLE_LABELS[user.role]}${user.region ? `, ${user.region}` : ""} — ${user.email}.`,
      fontSize: 9,
    });
    content.push({
      text: "This document is cryptographically verifiable. The chain hashes provide arithmetically undeniable proof of each transformer's complete history.",
      style: "muted", margin: [0, 14, 0, 0],
    });

    const buffer = await buildPdf({
      cover: {
        title: "Warranty Claim Pack",
        headline: addressee,
        subhead: `${claims.length} claim${claims.length === 1 ? "" : "s"} · ${formatKes(total)}`,
        meta: [
          ["Reference", reference],
          ["Prepared by", `${user.name} (${ROLE_LABELS[user.role]})`],
          ["Region", user.region ?? "All regions"],
          ["Date", new Date().toLocaleDateString("en-GB")],
        ],
      },
      content,
    });

    return pdf(buffer, `warranty-claim-pack-${addressee.replace(/\s+/g, "-").toLowerCase()}`);
  } catch (error) {
    return apiError(error);
  }
}
