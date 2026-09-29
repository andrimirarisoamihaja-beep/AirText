import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { BackgroundFX } from "@/components/fx";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Koragna — Messagerie éphémère, chiffrée, pair-à-pair",
  description:
    "Discussions instantanées totalement anonymes. Aucun compte, aucune inscription, aucune trace. Chiffrement de bout en bout, WebRTC pair-à-pair, messages jamais stockés.",
  applicationName: "Koragna",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Koragna" },
};

export const viewport: Viewport = {
  themeColor: "#05060a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${grotesk.variable} ${jetbrains.variable}`}>
      <body className="noise min-h-dvh antialiased">
        <Providers />
        <BackgroundFX />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
