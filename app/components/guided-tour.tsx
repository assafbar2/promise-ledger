"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

export type TourStep = { target: string; title: string; body: string; before?: () => void };

type Rect = { top: number; left: number; width: number; height: number };

/** The first rendered element for a target, so a step can name a desktop and a mobile control. */
function findTarget(target: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)).find((element) => element.getClientRects().length > 0) ?? null;
}

function measure(target: string): Rect | null {
  const element = findTarget(target);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

/**
 * A short first-run tour: a highlight ring around each target and a small card beside it.
 * Keyboard: Escape closes, arrow keys move. Focus goes to the card so screen readers announce it.
 */
export function GuidedTour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = useState(230);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  const place = useCallback(() => {
    setRect(measure(step.target));
    if (card.current) setCardHeight(card.current.offsetHeight);
  }, [step.target]);

  useLayoutEffect(() => {
    step.before?.();
    const frame = requestAnimationFrame(() => {
      const element = findTarget(step.target);
      // "instant" overrides the page's smooth scrolling, so the ring is measured where the target ends up.
      element?.scrollIntoView({ block: element.offsetHeight > window.innerHeight * 0.6 ? "start" : "center", inline: "nearest", behavior: "instant" });
      place();
      card.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [place, step]);

  useEffect(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [place]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && !last) setIndex((value) => value + 1);
      if (event.key === "ArrowLeft" && index > 0) setIndex((value) => value - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, last, onClose]);

  const pad = 6;
  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const cardWidth = Math.min(320, viewportWidth - 24);
  const gap = pad + 10;
  const maxTop = Math.max(12, viewportHeight - cardHeight - 12);
  // Below the target, else above it, else pinned inside the viewport over a target too tall for either.
  const cardTop = !rect ? Math.min(viewportHeight / 3, maxTop)
    : rect.top + rect.height + gap + cardHeight <= viewportHeight - 12 ? rect.top + rect.height + gap
      : rect.top - gap - cardHeight >= 12 ? rect.top - gap - cardHeight
        : maxTop;
  const cardStyle = { width: cardWidth, top: Math.max(12, Math.min(cardTop, maxTop)), left: rect ? Math.max(12, Math.min(rect.left, viewportWidth - cardWidth - 12)) : (viewportWidth - cardWidth) / 2 };

  return (
    <div className="tour-layer" role="presentation">
      {rect ? <div className="tour-ring" style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} /> : <div className="tour-dim" />}
      <div className="tour-card" ref={card} style={cardStyle} role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-body" tabIndex={-1}>
        <div className="tour-top"><span>QUICK TOUR · {index + 1} OF {steps.length}</span><button onClick={onClose} aria-label="Close the tour"><X size={14} /></button></div>
        <h3 id="tour-title">{step.title}</h3>
        <p id="tour-body">{step.body}</p>
        <div className="tour-progress" aria-hidden="true">{steps.map((item, dot) => <span key={item.target} className={dot === index ? "active" : dot < index ? "done" : ""} />)}</div>
        <div className="tour-actions">
          <button className="text-button" onClick={onClose}>Skip tour</button>
          <span>
            {index > 0 && <button className="button secondary" onClick={() => setIndex(index - 1)}><ArrowLeft size={13} />Back</button>}
            <button className="button primary" onClick={() => last ? onClose() : setIndex(index + 1)}>{last ? "Start exploring" : "Next"}{!last && <ArrowRight size={13} />}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
