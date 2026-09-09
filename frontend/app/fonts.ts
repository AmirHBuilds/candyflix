import { Fraunces, Inter } from "next/font/google";

// Fraunces: a warm, soft-terminal serif for titles — gives CandyFlix's
// "premium fantasy world" feeling without tipping into twee. Inter for
// everything else, since a browsing app lives and dies on readability.

export const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
});

export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
});
