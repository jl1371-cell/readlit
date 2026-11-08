import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, Noto_Serif_SC } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  style: ["normal", "italic"],
  axes: ["opsz", "SOFT"],
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Used only for translated text laid over serif papers; Google serves it in small unicode-range slices.
const notoSerifSC = Noto_Serif_SC({
  weight: ["400", "600"],
  variable: "--font-noto-serif-sc",
  preload: false,
  display: "swap",
});

export const metadata: Metadata = {
  title: "ReadLit — read any paper, in place",
  description: "Translate, explain and map any part of a research paper, right where you are reading.",
};

export const viewport: Viewport = {
  themeColor: "#faf6ef",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${notoSerifSC.variable}`}>
      <body>{children}</body>
    </html>
  );
}
