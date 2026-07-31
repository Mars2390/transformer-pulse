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
