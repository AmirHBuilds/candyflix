import type { Metadata } from "next";
import "./globals.css";
import { fraunces, inter } from "./fonts";

export const metadata: Metadata = {
  title: "CandyFlix",
  description: "A small, private movie & TV app.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="bg-[#0B0B12] text-white antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
