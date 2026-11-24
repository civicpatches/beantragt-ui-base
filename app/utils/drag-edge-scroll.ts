/**
 * Scrolling while dragging. A long form is several window heights tall, so
 * the target of a drag is often out of view: near the top or bottom edge of the scrolling area
 * the area scrolls by itself, faster the closer the pointer is to the edge.
 */
export const DRAG_EDGE_ZONE_PX = 72;

/*
 * The step was 24 px per frame, so the speed followed the screen's
 * refresh rate: 1440 px/s at 60 Hz, 2880 at 120 Hz; the checker measured 2556 px/s 10 px before the
 * edge. A person reading the cards that pass needs them slower than that, and the same on every
 * screen. The speed is per millisecond: at the very edge 1 px/ms, about 1000 px/s (a 900 px window
 * passes in about a second, still quick for a long form of several window heights), at the zone's inner
 * end 0.06 px/ms (60 px/s, what the old minimum of 1 px per frame gave at 60 Hz), in between linear.
 */
export const DRAG_EDGE_MAX_SPEED_PX_PER_MS = 1;
export const DRAG_EDGE_MIN_SPEED_PX_PER_MS = 0.06;
/** A frame longer than this (a busy or hidden tab) counts as this long, so the form never jumps. */
export const DRAG_EDGE_MAX_FRAME_MS = 50;

/**
 * Pixels (fractional) to scroll for a pointer at `pointerY` in an area from `top` to `bottom`, over
 * `elapsedMs` since the last frame. The caller keeps the fraction for the next frame.
 */
export function edgeScrollDelta(
    pointerY: number,
    top: number,
    bottom: number,
    elapsedMs: number,
    zone = DRAG_EDGE_ZONE_PX
): number {
    const height = bottom - top;
    if (height <= 0 || elapsedMs <= 0) return 0;
    const elapsed = Math.min(elapsedMs, DRAG_EDGE_MAX_FRAME_MS);
    const edge = Math.min(zone, height / 3);
    const speed = (closeness: number) =>
        DRAG_EDGE_MIN_SPEED_PX_PER_MS + (DRAG_EDGE_MAX_SPEED_PX_PER_MS - DRAG_EDGE_MIN_SPEED_PX_PER_MS) * closeness;
    if (pointerY < top + edge) {
        const closeness = 1 - Math.max(0, pointerY - top) / edge;
        return -speed(closeness) * elapsed;
    }
    if (pointerY > bottom - edge) {
        const closeness = 1 - Math.max(0, bottom - pointerY) / edge;
        return speed(closeness) * elapsed;
    }
    return 0;
}

/** The nearest ancestor that scrolls vertically, or null when the page itself scrolls. */
export function verticalScrollContainer(element: Element | null): HTMLElement | null {
    let current = element?.parentElement ?? null;
    while (current && current !== document.body && current !== document.documentElement) {
        const overflow = getComputedStyle(current).overflowY;
        if ((overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') && current.scrollHeight > current.clientHeight) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
}
