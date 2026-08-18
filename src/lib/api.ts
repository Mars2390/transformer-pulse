import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError, TooManyRequestsError } from "./auth";
import { LifecycleError } from "./events";
import { fieldErrors } from "./validation";

/**
 * One error shape for every endpoint, so the client handles failures in exactly
 * one place: { error: string, fields?: { name: message } }.
 */

export function apiError(error: unknown): NextResponse {
  // Above the AuthError branch: a throttled caller needs the Retry-After that
  // tells it when to come back, and AuthError has no room for a 429.
  if (error instanceof TooManyRequestsError) {
    return NextResponse.json(
      { error: error.message },
      { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
    );
  }

  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof LifecycleError) {
    // These messages are written for the person holding the phone. They explain
    // what is wrong and what to do, so they are safe to show as-is.
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Some fields need fixing.", fields: fieldErrors(error) },
      { status: 422 },
    );
  }

  // Prisma unique-constraint violation — a duplicate serial or G-Number.
  if (isPrismaError(error) && error.code === "P2002") {
    // Which column clashed is reported differently by every Prisma version and
    // driver. Prisma 6 put it in `meta.target`. Prisma 7 with the pg adapter
    // has no `target` at all — it buries the column under
    // meta.driverAdapterError.cause.constraint.fields, and repeats it in the
    // constraint name inside originalMessage.
    //
    // Rather than reach into one nested path that the next release will move,
    // search the whole metadata blob. The failure mode of a broad search here
    // is a slightly wrong message; the failure mode of a brittle path is the
    // useless "That record already exists" this replaced.
    const haystack = JSON.stringify(error.meta ?? {}).toLowerCase();

    const friendly: [string, string][] = [
      ["serialnumber", "A transformer with that serial number is already registered."],
      ["gnumber", "That G-Number is already in use by another transformer."],
      ["email", "An account with that email already exists."],
      ["clienteventid", "That event has already been recorded."],
      ["staffnumber", "That staff number is already in use."],
    ];

    const match = friendly.find(([key]) => haystack.includes(key));
    return NextResponse.json(
      { error: match?.[1] ?? "That record already exists." },
      { status: 409 },
    );
  }

  if (isPrismaError(error) && error.code === "P2025") {
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }

  console.error("Unhandled API error:", error);

  // In development the real message and stack come back in the response, so a
  // failure is debuggable from the browser's network tab. Never in production:
  // stack traces name file paths and query shapes an attacker can use.
  const detail =
    process.env.NODE_ENV === "production"
      ? undefined
      : { detail: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack?.split("\n").slice(0, 6) : undefined };

  return NextResponse.json(
    { error: "Something went wrong on our side.", ...detail },
    { status: 500 },
  );
}

type PrismaKnownError = { code: string; meta?: Record<string, unknown> };

function isPrismaError(error: unknown): error is PrismaKnownError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}
