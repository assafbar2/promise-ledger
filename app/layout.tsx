import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_BOOTSTRAP } from "@/app/components/theme-toggle";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://promise-ledger-chi.vercel.app";
const DESCRIPTION = "Engineering closed the ticket. Can the customer actually use it? Promise Ledger checks every customer promise against customer-specific evidence with NVIDIA Nemotron on Nebius Token Factory, then lets rules decide and a human send.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Promise Ledger — Promises made. Truth checked.", template: "%s · Promise Ledger" },
  description: DESCRIPTION,
  applicationName: "Promise Ledger",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Promise Ledger — Promises made. Truth checked.",
    description: "A closed engineering ticket is not a kept customer promise. Three NVIDIA Nemotron models read the evidence, deterministic rules decide, and a human approves every update.",
    url: SITE_URL,
    siteName: "Promise Ledger",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Promise Ledger: “Done” in engineering, not delivered to the customer. Built yes, enabled no, verified unknown: delivery gap." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Promise Ledger — Promises made. Truth checked.",
    description: "Customer promises checked against customer-specific evidence. NVIDIA Nemotron on Nebius Token Factory; rules decide; humans send.",
    images: ["/og.png"],
  },
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/favicon.ico", sizes: "32x32" }], apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1816" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
