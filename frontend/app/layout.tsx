import type { Metadata, Viewport } from "next";
import "./globals.css";
import { fraunces, inter } from "./fonts";
import Toaster from "@/components/Toaster";
import { appearanceAttributes, themeCanvas } from "@/lib/appearance";
import { getServerSettings } from "@/lib/settings-server";

export const metadata: Metadata = {
  title: "CandyFlix",
  description: "A small, private movie & TV app.",
};

// Matches the browser's address bar to the app on phones, and tells the
// browser the page is dark so native bits (scrollbars, form controls,
// pull-to-refresh) don't flash white.
export async function generateViewport(): Promise<Viewport> {
  const { appearance } = await getServerSettings();
  return { themeColor: themeCanvas(appearance.theme), colorScheme: "dark" };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="bg-canvas text-white antialiased min-h-dvh">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
