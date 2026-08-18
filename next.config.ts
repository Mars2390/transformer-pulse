import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // pdfmake must be required from node_modules at runtime, not bundled.
  // pdfkit (underneath it) reads Helvetica.afm and friends — the font metric
  // files for the PDF standard-14 fonts — from its own package directory. When
  // webpack inlines the JS into a vendor chunk those data files are left
  // behind, and every PDF fails with ENOENT on Helvetica-Bold.afm.
  // Both ship native/binary assets the bundler would otherwise mangle: pdfmake
  // needs pdfkit's .afm font metrics, sharp is a native addon.
  serverExternalPackages: ["pdfmake", "sharp"],

  // OAuth discovery metadata (RFC 8414 / RFC 9728) MUST be served from these
  // exact dot-prefixed paths — that is where MCP clients look, unconditionally.
  // Next.js route files can't live in a literal ".well-known" folder, so the
  // real handlers sit under /api/mcp-well-known and are rewritten here.
  /**
   * Security headers, sent on every response.
   *
   * Set here rather than in middleware so they cost nothing at runtime and
   * cannot be missed by a route that forgets to call a helper.
   *
   * The CSP is the part that needs judgement. Next.js injects inline bootstrap
   * scripts and React inlines hydration data, so 'unsafe-inline' on script-src
   * is required unless every response carries a per-request nonce — which
   * means rendering the CSP in middleware and threading the nonce through the
   * app. That is the correct end state and it is a change to how every page
   * renders, not a header edit, so it is deliberately not bundled into this
   * pass. What is here still removes the classes that matter most: no framing,
   * no plugins, no base-tag hijack, no form posting to another origin, and
   * connections limited to this origin.
   *
   * 'unsafe-eval' is NOT present. Leaflet, ExcelJS and pdfmake all run without
   * it.
   */
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            // Map tiles come from OpenStreetMap and Esri; blob: and data: are
            // used for generated QR codes and photo previews.
            "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://server.arcgisonline.com https://*.public.blob.vercel-storage.com",
            "font-src 'self' data:",
            "connect-src 'self' https://*.public.blob.vercel-storage.com",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "object-src 'none'",
            "upgrade-insecure-requests",
          ].join("; "),
        },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          // Geolocation and camera stay enabled for this origin: field
          // engineers capture GPS and scan nameplates. Everything else is off.
          value: "geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=()",
        },
        {
          key: "Strict-Transport-Security",
          // Two years, subdomains included. preload is omitted on purpose:
          // submitting to the browser preload list is effectively irreversible
          // and should be a decision KPLC makes explicitly, not a side effect
          // of a header change.
          value: "max-age=63072000; includeSubDomains",
        },
        { key: "X-DNS-Prefetch-Control", value: "off" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    },
    {
      // Never let a report or an export be cached by a shared proxy.
      source: "/api/:path*",
      headers: [
        { key: "Cache-Control", value: "no-store, max-age=0" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
  ],

  rewrites: async () => [
    {
      source: "/.well-known/oauth-authorization-server",
      destination: "/api/mcp-well-known/oauth-authorization-server",
    },
    {
      source: "/.well-known/oauth-protected-resource",
      destination: "/api/mcp-well-known/oauth-protected-resource",
    },
  ],
};

export default nextConfig;
