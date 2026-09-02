import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="bg-[#0B0B12] text-white antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
