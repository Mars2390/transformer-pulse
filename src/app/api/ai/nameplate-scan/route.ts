import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import {
  NAMEPLATE_PROMPT,
  aiNameplateSchema,
  extractJson,
  normaliseAiResult,
} from "@/lib/nameplate-ai";

export const maxDuration = 60;

/**
 * POST /api/ai/nameplate-scan — read a nameplate photograph with a vision model.
 *
 * The key lives ONLY in process.env.OPENROUTER_API_KEY on the server. It is
 * never sent to the browser, never written into the repository, and never
 * returned in a response. If it is absent the route says so plainly and the
 * caller falls back to manual entry — a missing key must never block a receipt.
 *
 * Model choice is an environment variable with a free default, so swapping it
 * costs a Vercel setting rather than a deploy. Vision models on OpenRouter come
 * and go; if the configured one disappears the route reports the provider's own
 * error rather than pretending the plate was blank.
 */
const DEFAULT_MODEL = "meta-llama/llama-3.2-11b-vision-instruct:free";

export async function POST(request: Request) {
  try {
    // Any signed-in user may scan; the route reads a photograph they already
    // uploaded to our own blob store, so there is nothing here a store keeper
    // could not already see.
    const actor = await requireApiUser();

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error: "AI scanning is not configured on this deployment. Enter the nameplate by hand.",
          configured: false,
        },
        { status: 503 },
      );
    }

    const body = (await request.json().catch(() => null)) as { imageUrl?: string } | null;
    const imageUrl = body?.imageUrl?.trim();
    if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
      return NextResponse.json({ error: "No photograph was supplied." }, { status: 422 });
    }

    const model = process.env.OPENROUTER_VISION_MODEL || DEFAULT_MODEL;

    const started = Date.now();
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // OpenRouter uses these for attribution on its dashboard.
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://transformer-pulse.vercel.app",
        "X-Title": "Transformer DNA — nameplate scan",
      },
      body: JSON.stringify({
        model,
        // Zero temperature: this is a reading task. Any creativity here is a
        // fabricated nameplate field.
        temperature: 0,
        max_tokens: 1600,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: NAMEPLATE_PROMPT },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        {
          error: "The reading service refused the request. Enter the nameplate by hand.",
          status: res.status,
          detail: detail.slice(0, 400),
        },
        { status: 502 },
      );
    }

    const payload = (await res.json().catch(() => null)) as
      | { choices?: { message?: { content?: string } }[] }
      | null;
    const content = payload?.choices?.[0]?.message?.content ?? "";

    const json = extractJson(content);
    const parsed = aiNameplateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "The reading came back in a shape we could not trust, so nothing was filled in.",
          rawText: content.slice(0, 2000),
        },
        { status: 422 },
      );
    }

    const result = normaliseAiResult(parsed.data);

    // Logged, because a store keeper asking "why did it say 3500" deserves an
    // answer, and because a model quietly getting worse should be visible.
    await prisma.mcpAccessLog
      .create({
        data: {
          userId: actor.id,
          tool: "nameplate-scan",
          success: !result.unreadable,
          argsSummary: `${model} · ${result.readCount} read, ${result.rejectedCount} rejected · ${Date.now() - started}ms`,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({
      model,
      elapsedMs: Date.now() - started,
      ...result,
      message: result.unreadable
        ? "That does not look like a rating plate. Enter the details by hand."
        : `Read ${result.readCount} fields.${result.rejectedCount ? ` ${result.rejectedCount} implausible values were dropped.` : ""} Check every one against the plate before saving.`,
    });
  } catch (error) {
    return apiError(error);
  }
}
