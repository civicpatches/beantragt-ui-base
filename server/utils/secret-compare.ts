import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison of two secrets.
 *
 * Neutral base infrastructure, deliberately not layer 4: it carries no
 * intelligence substance and the open half needs it for its own auth paths.
 * `timingSafeEqual` throws on length mismatch, so the length is checked first.
 */
export function equalSecret(a: string, b: string): boolean {
    if (!a || !b) return false;
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}
