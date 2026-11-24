import { DELIVERY_ROUTES, ROUTE_REASONS, type DeliveryPreview, type DeliveryRoute, type DeliveryRouteDecision } from '~~/app/types/delivery';
import type { DocgenFormDelivery } from '~~/app/types/docgen';

type Json = Record<string, unknown>;
const record = (value: unknown): Json => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const enumValue = <T extends string>(value: unknown, allowed: readonly T[]): T | null => typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null;

/** Known, unique routes in `DeliveryRoute::ROUTES` order. */
export function deliveryRouteList(value: unknown): DeliveryRoute[] {
    const given = Array.isArray(value) ? value : [];
    return DELIVERY_ROUTES.filter(route => given.includes(route));
}

export function sanitizeDeliveryDecision(value: unknown): DeliveryRouteDecision | null {
    const decision = record(value);
    const route = enumValue(decision.route, DELIVERY_ROUTES);
    return route ? { route, reason: enumValue(decision.reason, ROUTE_REASONS) } : null;
}

/** Both kinds or nothing: a half preview would show a release text without its basis. */
export function sanitizeDeliveryPreview(value: unknown): DeliveryPreview | null {
    const preview = record(value);
    const decision = sanitizeDeliveryDecision(preview.decision);
    const communication = sanitizeDeliveryDecision(preview.communication);
    return decision && communication ? { decision, communication } : null;
}

/**
 * Form settings `delivery` (docgen GET/PUT forms/:id). `routes: []` with
 * `default: ''` is the unconfigured form. `availableRoutes` lists what can
 * be used; portal and post always can, so an older backend without the
 * key never makes them look unavailable.
 */
export function sanitizeFormDelivery(value: unknown): DocgenFormDelivery {
    const delivery = record(value);
    const routes = deliveryRouteList(delivery.routes);
    const fallback = enumValue(delivery.default, DELIVERY_ROUTES);
    const availableRoutes = Array.isArray(delivery.availableRoutes)
        ? deliveryRouteList(delivery.availableRoutes)
        : DELIVERY_ROUTES.filter(route => route !== 'bundid');
    return {
        configured: routes.length > 0 && delivery.configured !== false,
        routes,
        default: fallback && routes.includes(fallback) ? fallback : '',
        availableRoutes
    };
}
