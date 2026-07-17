import Image from "next/image";
import Link from "next/link";
import { Hero } from "@/components/marketing/Hero";
import { PhotoStrip } from "@/components/marketing/PhotoStrip";
import { Reveal } from "@/components/marketing/Reveal";
import { SiteNav } from "@/components/marketing/SiteNav";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { BackToTop } from "@/components/marketing/BackToTop";
import {
  IconArrowRight,
  IconClipboard,
  IconPin,
  IconShield,
  IconTruck,
  IconCamera,
  IconGauge,
  IconChart,
} from "@/components/marketing/icons";

/**
 * The landing page.
 *
 * Six sections, no more. Every claim on this page describes something the
 * system actually does — there are no statistics here, because we do not yet
 * have real ones, and a fabricated number is the fastest way to lose a room of
 * engineers who know the real ones.
 */

const CAPABILITIES = [
  {
    icon: IconClipboard,
    image: "/images/transformer-unit.jpg",
    title: "Register at intake",
    body: "Serial number, make, rating, year and G-Number are recorded once, when the store receives the unit. The warranty clock starts on that date.",
  },
  {
    icon: IconTruck,
    image: "/images/transformer-in-transit.jpg",
    title: "Custody on every move",
    body: "Each movement records the vehicle, the number plate, the driver and the time. Nothing leaves a store without a name attached to it.",
  },
  {
    icon: IconPin,
    image: "/images/pole-mounted-transformer.jpg",
    title: "Located in the field",
    body: "Installation captures a GPS point and a photograph taken at the pole. The map stops being a guess.",
  },
  {
    icon: IconShield,
    image: "/images/substation-switchyard.jpg",
    title: "Warranty and returns",
    body: "When a fault is reported, the record is checked against the warranty window immediately, and the claim is raised against the manufacturer.",
  },
];

const STEPS = [
  {
    icon: IconClipboard,
    title: "Register",
    body: "The store records the transformer against its serial number and assigns a G-Number.",
  },
  {
    icon: IconTruck,
    title: "Dispatch",
    body: "Loading records the vehicle, number plate and driver before it leaves the yard.",
  },
  {
    icon: IconCamera,
    title: "Install",
    body: "The field engineer submits a GPS point, a photograph and the commissioning tests from site.",
  },
  {
    icon: IconChart,
    title: "Monitor",
    body: "The regional manager sees every transformer on the map, with its status, history and warranty position.",
  },
];

export default function LandingPage() {
  return (
    <>
      <SiteNav />

      <main>
        {/* ---------------- 1. Hero ---------------------------------------- */}
        <Hero />

        {/* ---------------- 2. Capabilities -------------------------------- */}
        <section id="capabilities" className="bg-surface py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <Reveal>
              <p className="text-xs font-bold tracking-[0.14em] text-kplc">
                WHAT THE SYSTEM DOES
              </p>
              <h2 className="mt-3 max-w-2xl text-[clamp(1.6rem,3.4vw,2.4rem)] font-extrabold text-navy">
                Four things paper cannot do
              </h2>
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-soft">
                Each of these is recorded once, by the person doing the work, at
                the moment the work happens.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {CAPABILITIES.map((item, i) => {
                const Icon = item.icon;
                return (
                  <Reveal key={item.title} delay={i * 80} className="h-full">
                    <article className="group h-full rounded-2xl border border-line bg-white transition-all duration-300 hover:-translate-y-1.5 hover:border-kplc/40 hover:shadow-xl hover:shadow-navy/8">
                      {/* The badge hangs over the bottom edge of the photo, so
                          the clipping container is the inner div only — putting
                          overflow-hidden any higher cuts the badge in half. */}
                      <div className="relative">
                        <div className="relative aspect-[16/10] overflow-hidden rounded-t-2xl bg-surface-2">
                          <Image
                            src={item.image}
                            alt=""
                            fill
                            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                            className="object-cover transition-transform duration-700 ease-out group-hover:scale-108"
                          />
                        </div>
                        <span className="absolute -bottom-5 left-4 z-10 grid h-11 w-11 place-items-center rounded-xl bg-kplc text-white shadow-lg shadow-navy/25 ring-4 ring-white transition-colors duration-300 group-hover:bg-gold group-hover:text-navy-dark">
                          <span className="h-5 w-5">
                            <Icon />
                          </span>
                        </span>
                      </div>

                      <div className="px-5 pb-6 pt-9">
                        <h3 className="text-base font-bold text-navy">
                          {item.title}
                        </h3>
                        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
                          {item.body}
                        </p>
                      </div>
                    </article>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---------------- 3. Lifecycle banner ---------------------------- */}
        <section
          id="lifecycle"
          className="relative overflow-hidden bg-navy py-20 sm:py-28"
        >
          {/* The transmission line, dropped almost to texture. This is the one
              high-resolution photograph we have, which is why it can survive
              being stretched full-bleed across a wide band. */}
          <Image
            src="/images/grid-transmission-line.jpg"
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-center opacity-20"
          />
          <div
            className="absolute inset-0 bg-gradient-to-r from-navy via-navy/95 to-navy/75"
            aria-hidden="true"
          />

          {/* Faint engineering grid, faded out at the edges */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
              backgroundSize: "56px 56px",
              maskImage:
                "radial-gradient(ellipse 70% 60% at 50% 50%, black 30%, transparent 100%)",
            }}
            aria-hidden="true"
          />

          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-2 lg:gap-16">
            <Reveal>
              <h2 className="max-w-md text-[clamp(1.7rem,3.6vw,2.6rem)] font-extrabold text-white">
                From the store to the pole, on one record
              </h2>
              <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-white/65 sm:text-base">
                Open the dashboard and every transformer in the region appears on
                the map. Tap a pin and the record opens: who received it, which
                lorry carried it, who installed it, what the tests said, and
                whether it is still under warranty.
              </p>
              <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-white/65 sm:text-base">
                The history is append-only. A transformer that moves creates a
                new entry — nothing already written is edited or removed.
              </p>

              <Link
                href="/dashboard"
                className="group mt-9 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-bold text-navy shadow-lg shadow-navy-dark/30 transition-all hover:-translate-y-0.5 hover:bg-gold"
              >
                Open the dashboard
                <span className="h-4 w-4 transition-transform group-hover:translate-x-0.5">
                  <IconArrowRight />
                </span>
              </Link>
            </Reveal>

            <Reveal delay={120}>
              <div className="overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-navy-dark/50">
                <Image
                  src="/images/logistics-illustration.jpg"
                  alt="A transformer being delivered by lorry to a substation while engineers record the handover."
                  width={1200}
                  height={663}
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="h-auto w-full"
                />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---------------- 4. Network photo strip -------------------------- */}
        <section id="network" className="bg-surface py-20 sm:py-28">
          <Reveal>
            <PhotoStrip />
          </Reveal>
        </section>

        {/* ---------------- 5. How it works -------------------------------- */}
        <section id="how" className="bg-surface-2 py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <Reveal className="text-center">
              <p className="text-xs font-bold tracking-[0.14em] text-kplc">
                THE WORKFLOW
              </p>
              <h2 className="mx-auto mt-3 max-w-2xl text-[clamp(1.6rem,3.4vw,2.4rem)] font-extrabold text-navy">
                From delivery note to field record in four steps
              </h2>
            </Reveal>

            <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, i) => {
                const Icon = step.icon;
                return (
                  <Reveal key={step.title} delay={i * 80}>
                    <div className="group relative h-full rounded-2xl border border-line bg-white px-6 pb-7 pt-10 transition-all duration-300 hover:-translate-y-1.5 hover:border-kplc/40 hover:shadow-xl hover:shadow-navy/8">
                      {/* Number circle floating above the card */}
                      <span className="absolute -top-4 left-6 grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-kplc to-navy text-sm font-bold text-white shadow-lg shadow-navy/25">
                        {i + 1}
                      </span>

                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-kplc/8 text-kplc transition-colors duration-300 group-hover:bg-gold/15 group-hover:text-gold-dark">
                        <span className="h-5 w-5">
                          <Icon />
                        </span>
                      </span>

                      <h3 className="mt-4 text-base font-bold text-navy">
                        {step.title}
                      </h3>
                      <p className="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
                        {step.body}
                      </p>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---------------- 6. Closing CTA --------------------------------- */}
        <section className="bg-surface-2 px-5 pb-24 sm:px-8">
          <Reveal>
            <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[28px] px-6 py-20 text-center sm:px-16 sm:py-24">
              {/* Photograph, then a heavy navy wash over it. The image is here
                  to give the panel depth — it must never compete with the text,
                  so the overlay stays dark enough to keep contrast well clear
                  of the accessibility floor. */}
              <Image
                src="/images/transformer-installation.jpg"
                alt=""
                fill
                sizes="100vw"
                className="object-cover object-center"
              />
              <div
                className="absolute inset-0 bg-gradient-to-br from-navy-dark/97 via-navy/92 to-kplc/80"
                aria-hidden="true"
              />

              <span
                className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold/10 blur-3xl"
                aria-hidden="true"
              />
              <span
                className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-kplc-light/20 blur-3xl"
                aria-hidden="true"
              />

              <div className="relative">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-white/15 bg-white/10 text-gold backdrop-blur-md">
                  <span className="h-6 w-6">
                    <IconGauge />
                  </span>
                </span>

                <h2 className="mx-auto mt-6 max-w-2xl text-[clamp(1.7rem,3.6vw,2.5rem)] font-extrabold text-white">
                  Every transformer has a story. See one.
                </h2>
                <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-white/65 sm:text-base">
                  Open the dashboard for the map, the transformer list, and a
                  full lifecycle record from registration to the field.
                </p>

                <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
                  <Link
                    href="/dashboard"
                    className="group inline-flex items-center justify-center gap-2 rounded-xl bg-gold px-7 py-3.5 text-sm font-bold text-navy-dark shadow-lg shadow-gold/20 transition-all hover:-translate-y-0.5 hover:bg-gold-dark"
                  >
                    Open dashboard
                    <span className="h-4 w-4 transition-transform group-hover:translate-x-0.5">
                      <IconArrowRight />
                    </span>
                  </Link>
                  <Link
                    href="/login"
                    className="inline-flex items-center justify-center rounded-xl border border-white/25 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-white/50 hover:bg-white/10"
                  >
                    Sign in
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
      <BackToTop />
    </>
  );
}
