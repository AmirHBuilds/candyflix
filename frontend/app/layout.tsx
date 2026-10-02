import type { Metadata, Viewport } from "next";
import "./globals.css";
import { fraunces, inter } from "./fonts";
import Toaster from "@/components/Toaster";

export const metadata: Metadata = {
  title: "CandyFlix",
  description: "A small, private movie & TV app.",
};

// Matches the browser's address bar to the app on phones, and tells the
// browser the page is dark so native bits (scrollbars, form controls,
// pull-to-refresh) don't flash white.
export const viewport: Viewport = {
  themeColor: "#0B0B12",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="bg-[#0B0B12] text-white antialiased min-h-dvh">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
