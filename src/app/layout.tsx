import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Transformer DNA — Transformer tracking for Kenya Power",
    template: "%s · Transformer DNA",
  },
  description:
    "Track every distribution transformer from the manufacturer, through the store, to the field. Location, custody, test records and warranty status in one place.",
  applicationName: "Transformer DNA",
  openGraph: {
    title: "Transformer DNA",
    description:
      "Track every distribution transformer from the manufacturer, through the store, to the field.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a1a4f",
  width: "device-width",
  initialScale: 1,
  // Field engineers pinch-zoom into nameplates and serial numbers.
  // Never lock scaling.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={figtree.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
