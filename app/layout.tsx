import type { Metadata } from "next";
import { JetBrains_Mono, Orbitron } from "next/font/google";
import "./globals.css";

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MASTER EYE — Global Tactical Overwatch",
  description:
    "Real-time tactical global intelligence dashboard: live aircraft, OSINT webcams, and emergency/aviation audio feeds on a CesiumJS globe.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${jetbrains.variable} ${orbitron.variable} min-h-screen bg-[#030712] font-mono text-cyan-100 antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
