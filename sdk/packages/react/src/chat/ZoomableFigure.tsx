// ZoomableFigure —— a rendered diagram (mermaid, TikZ) in an answer, with a button in its top-right
// corner that opens it large in the middle of the screen. A diagram sized to a chat column (a rail,
// a phone dock) is often too small to read (owner, 2026-09-30).
//
// The large view grows out of the diagram itself: the stage is laid out at its final place, then
// animated from the figure's own box (FLIP — first, last, invert, play), and it shrinks back into it
// on close. Motion is skipped for a visitor who asks the system for reduced motion.
//
// The SVG is the same string the figure shows; the overlay is portalled to <body> so no transformed
// or clipped ancestor (the rail's scroll box, the dock panel) can hold it inside itself.

'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useChatT } from '../i18n.js';

const DURATION_MS = 280;
const EASING = 'cubic-bezier(.22,1,.36,1)';

export function ZoomableFigure({ svg, className, testid }: {
  svg: string; className: string; testid: string;
}): React.ReactElement {
  const t = useChatT('transcript');
  const bodyRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className={`smc-figure ${className}`} data-testid={testid}>
      <button
        type="button" className="smc-figure-zoom" data-testid="figure-zoom"
        aria-label={t('enlargeDiagram')} title={t('enlargeDiagram')}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">⤢</span>
      </button>
      <div ref={bodyRef} className="smc-figure-body" dangerouslySetInnerHTML={{ __html: svg }} />
      {open && <ZoomOverlay svg={svg} from={bodyRef} onClosed={() => setOpen(false)} />}
    </div>
  );
}

function ZoomOverlay({ svg, from, onClosed }: {
  svg: string; from: React.RefObject<HTMLDivElement | null>; onClosed: () => void;
}): React.ReactPortal {
  const t = useChatT('transcript');
  const backdropRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  // Open: play from the figure's box to the stage's own place.
  useLayoutEffect(() => {
    void play(backdropRef.current, stageRef.current, from.current, 'open');
  }, [from]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    void play(backdropRef.current, stageRef.current, from.current, 'close').then(onClosed);
  }, [from, onClosed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [close]);

  return createPortal(
    <div
      ref={backdropRef} className="smc-zoom" data-testid="figure-zoom-overlay"
      role="dialog" aria-modal="true" aria-label={t('enlargeDiagram')}
      onClick={close}
    >
      <button type="button" className="smc-zoom-close" aria-label={t('closeDiagram')} onClick={close}>
        <span aria-hidden="true">×</span>
      </button>
      <div
        ref={stageRef} className="smc-zoom-stage"
        onClick={(e) => { e.stopPropagation(); }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>,
    document.body,
  );
}

// play —— the FLIP step. The stage already sits at its large place; the keyframe that matches the
// figure's box is computed from both boxes, so the diagram visibly grows out of (and back into) the
// spot it was read in. Resolves when the motion ends (at once with reduced motion or no WAAPI).
function play(
  backdrop: HTMLElement | null, stage: HTMLElement | null, figure: HTMLElement | null,
  dir: 'open' | 'close',
): Promise<void> {
  if (backdrop === null || stage === null || figure === null || !animatable(stage)) return Promise.resolve();
  const src = figure.getBoundingClientRect();
  const dst = stage.getBoundingClientRect();
  const scale = dst.width > 0 ? src.width / dst.width : 1;
  const dx = src.left + src.width / 2 - (dst.left + dst.width / 2);
  const dy = src.top + src.height / 2 - (dst.top + dst.height / 2);
  const small = { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.6 };
  const large = { transform: 'none', opacity: 1 };
  const frames = dir === 'open' ? [small, large] : [large, small];
  const shade = dir === 'open' ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }];
  const opts: KeyframeAnimationOptions = { duration: DURATION_MS, easing: EASING, fill: 'forwards' };
  backdrop.animate(shade, opts);
  return stage.animate(frames, opts).finished.then(() => undefined, () => undefined);
}

function animatable(el: HTMLElement): boolean {
  try {
    return typeof el.animate === 'function'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
