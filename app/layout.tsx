import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fraunces, Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Fraunces (display serif, hand-cut/botanical), Instrument Sans (humanist body, deliberately not
// Inter), IBM Plex Mono (instrument-readout data). See DESIGN.md.
const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});
const sans = Instrument_Sans({ variable: "--font-sans", subsets: ["latin"] });
const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const TITLE = "Bonsai — prune the conversation to its living wood";
const DESCRIPTION =
  "Tree-structured AI chat: branch a side question with a compiled minimal brief, auto-route the model and effort, merge one distilled insight back.";

export const metadata: Metadata = {
  metadataBase: new URL("https://bonsai-connector.vercel.app"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "The Bonsai garden and chat pane" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.jpg"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
