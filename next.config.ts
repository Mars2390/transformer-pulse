import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // pdfmake must be required from node_modules at runtime, not bundled.
  // pdfkit (underneath it) reads Helvetica.afm and friends — the font metric
  // files for the PDF standard-14 fonts — from its own package directory. When
  // webpack inlines the JS into a vendor chunk those data files are left
  // behind, and every PDF fails with ENOENT on Helvetica-Bold.afm.
  serverExternalPackages: ["pdfmake"],
};

export default nextConfig;
