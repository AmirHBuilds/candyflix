"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HOLD_BASE_RATE,
  HOLD_DELAY_MS,
  HOLD_MOVE_TOLERANCE_PX,
  holdRateFromPosition,
} from "@/components/player/hold-speed";

type PointerHold = {
  id: number;
  el: HTMLElement;
  startX: number; // px from the element's left edge
  startY: number;
  left: number;
  width: number;
  clientStartX: number;
  clientStartY: number;
};

/**
 * Press-and-hold speed control (see hold-speed.ts for the mapping).
 *
 * Two independent triggers share one "hold" state:
 * - a pointer (finger / mouse / pen) held on the surface these handlers
 *   are attached to — sliding left/right while holding changes the rate;
 * - the Space bar held down — a fixed 2x (a keyboard has no position).
 *
 * A hold only starts while the video is actually playing, and the
 * previous playback rate is restored the moment it ends. `holdRate` is
 * null when no hold is active, otherwise the live rate (for the indicator).
 */
export function useHoldSpeed(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [holdRate, setHoldRate] = useState<number | null>(null);

  const activeRef = useRef(false);
  const previousRateRef = useRef(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerRef = useRef<PointerHold | null>(null);
  const spaceRef = useRef<"idle" | "down" | "holding">("idle");
  // The click a finished hold would otherwise produce (release over a
  // button = "click") must not also toggle play/pause.
  const suppressClickRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const engage = useCallback(
    (rate: number): boolean => {
      const video = videoRef.current;
      if (!video || activeRef.current || video.paused || video.ended) return false;
      previousRateRef.current = video.playbackRate;
      video.playbackRate = rate;
      activeRef.current = true;
      setHoldRate(rate);
      return true;
    },
    [videoRef]
  );

  const end = useCallback(() => {
    clearTimer();
    if (!activeRef.current) return;
    activeRef.current = false;
    const video = videoRef.current;
    if (video) video.playbackRate = previousRateRef.current;
    setHoldRate(null);
  }, [clearTimer, videoRef]);

  // --- Pointer (touch / mouse / pen) ---

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (pointerRef.current) return; // a second finger doesn't start another hold
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      pointerRef.current = {
        id: e.pointerId,
        el,
        startX: e.clientX - rect.left,
        startY: e.clientY - rect.top,
        left: rect.left,
        width: rect.width,
        clientStartX: e.clientX,
        clientStartY: e.clientY,
      };
      clearTimer();
      timerRef.current = setTimeout(() => {
        const p = pointerRef.current;
        if (!p || !engage(HOLD_BASE_RATE)) return;
        suppressClickRef.current = true;
        // Keep receiving moves when the finger/cursor leaves the element.
        // Deliberately only now: capturing at pointerdown would retarget
        // the ordinary click of a plain tap away from its button.
        p.el.setPointerCapture?.(p.id);
      }, HOLD_DELAY_MS);
    },
    [clearTimer, engage]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const p = pointerRef.current;
      if (!p || e.pointerId !== p.id) return;
      if (!activeRef.current) {
        // Moved before the delay elapsed — a drag/scroll attempt, not a hold.
        const moved = Math.hypot(e.clientX - p.clientStartX, e.clientY - p.clientStartY);
        if (moved > HOLD_MOVE_TOLERANCE_PX) clearTimer();
        return;
      }
      const rate = holdRateFromPosition(e.clientX - p.left, p.startX, p.width);
      const video = videoRef.current;
      if (video) video.playbackRate = rate;
      setHoldRate(rate);
    },
    [clearTimer, videoRef]
  );

  const onPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const p = pointerRef.current;
      if (!p || e.pointerId !== p.id) return;
      pointerRef.current = null;
      const wasHolding = activeRef.current;
      end();
      if (wasHolding) {
        // The click (if any) fires right after pointerup; clear the flag
        // shortly after in case none does (release outside the button).
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 100);
      } else {
        suppressClickRef.current = false;
      }
    },
    [end]
  );

  /** True (once) if the click that's being handled is the tail of a hold. */
  const consumeSuppressedClick = useCallback((): boolean => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  // --- Space bar ---

  /** Call on the first (non-repeat) keydown of Space. */
  const onSpaceDown = useCallback(() => {
    if (spaceRef.current !== "idle") return;
    spaceRef.current = "down";
    clearTimer();
    timerRef.current = setTimeout(() => {
      if (spaceRef.current === "down" && engage(HOLD_BASE_RATE)) spaceRef.current = "holding";
    }, HOLD_DELAY_MS);
  }, [clearTimer, engage]);

  /**
   * Call on Space keyup. "tap" → the caller should toggle play/pause;
   * "hold" → a hold just ended (don't toggle); null → nothing was pending.
   */
  const onSpaceUp = useCallback((): "tap" | "hold" | null => {
    const state = spaceRef.current;
    spaceRef.current = "idle";
    if (state === "idle") return null;
    if (state === "holding") {
      end();
      return "hold";
    }
    clearTimer();
    return "tap";
  }, [clearTimer, end]);

  // Losing focus mid-hold (alt-tab, a dialog) can swallow the keyup /
  // pointerup — never leave the video stuck at 2x.
  useEffect(() => {
    function reset() {
      pointerRef.current = null;
      spaceRef.current = "idle";
      end();
    }
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("blur", reset);
      clearTimer();
    };
  }, [clearTimer, end]);

  return {
    holdRate,
    surfaceHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    },
    consumeSuppressedClick,
    onSpaceDown,
    onSpaceUp,
  };
}
