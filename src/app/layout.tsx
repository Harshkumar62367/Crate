import type { Metadata, Viewport } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const space = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "Crate — drag in a folder, ask your agent",
  description:
    "Crate turns any folder of files into an agent-native, searchable, citable workspace — entirely in your browser. WebMCP-native: no upload, no account, no API key.",
};

export const viewport: Viewport = {
  themeColor: "#faf7f2",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${space.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
