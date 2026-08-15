import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { KplcMark } from "@/components/brand/KplcLogo";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <main className="relative isolate flex min-h-svh flex-col items-center justify-center overflow-hidden bg-navy-dark px-5 py-12">
      {/* --- Background photograph ------------------------------------------
          A crew putting a transformer on a pole: the work this system records.
          It sits under a heavy navy wash — the image gives the page depth, and
          the moment you can read the image you cannot read the form. */}
      <Image
        src="/images/transformer-installation.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-center"
      />
      <div
        className="absolute inset-0 bg-gradient-to-br from-navy-dark/96 via-navy/92 to-navy-dark/97"
        aria-hidden="true"
      />

      {/* Engineering grid, faded toward the edges. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "52px 52px",
          maskImage:
            "radial-gradient(ellipse 70% 60% at 50% 45%, black 25%, transparent 100%)",
        }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -top-32 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-kplc/20 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative w-full max-w-[26rem]">
        {/* --- Brand --------------------------------------------------------- */}
        <div className="mb-8 flex flex-col items-center text-center">
          <KplcMark className="h-14 w-14" />
          <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-white">
            Transformer<span className="text-gold">DNA</span>
          </h1>
          <p className="mt-1.5 text-sm text-white/50">
            Kenya Power Distribution Assets
          </p>
        </div>

        {/* --- Card ---------------------------------------------------------- */}
        <div className="rounded-2xl border border-white/10 bg-white p-6 shadow-2xl shadow-navy-dark/50 sm:p-8">
          <h2 className="text-lg font-bold text-navy">Sign in</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Use your KPLC email and 6-digit PIN.
          </p>

          <div className="mt-6">
            {/* useSearchParams needs a Suspense boundary, or the whole route
                is forced out of static rendering. */}
            <Suspense
              fallback={<div className="h-64 animate-pulse rounded-xl bg-surface" />}
            >
              <LoginForm />
            </Suspense>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-white/35">
          <Link href="/" className="transition-colors hover:text-white/70">
            ← Back to Transformer DNA
          </Link>
        </p>
      </div>
    </main>
  );
}
