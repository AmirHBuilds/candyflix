"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useRef, useState } from "react";

/**
 * next/image that eases in once it has actually loaded, instead of
 * popping in half-drawn.
 *
 * The server-rendered HTML is fully visible and stays that way for any
 * image the browser already has (cached / fast) — so nothing is ever
 * hidden waiting for JavaScript. Only an image that is genuinely still
 * loading when the component mounts is held transparent until its
 * onLoad (or onError, so a broken image shows its alt text rather than
 * staying invisible). Reduced-motion users get no fade — see globals.css.
 */
export default function FadeImage({ className = "", onLoad, onError, ...props }: ImageProps) {
  const ref = useRef<HTMLImageElement>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const img = ref.current;
    if (img && !img.complete) setWaiting(true);
  }, []);

  return (
    <Image
      {...props}
      ref={ref}
      className={`${className} [transition:opacity_0.5s_ease-out,transform_0.2s_ease-out] ${waiting ? "opacity-0" : "opacity-100"}`}
      onLoad={(e) => {
        setWaiting(false);
        onLoad?.(e);
      }}
      onError={(e) => {
        setWaiting(false);
        onError?.(e);
      }}
    />
  );
}
