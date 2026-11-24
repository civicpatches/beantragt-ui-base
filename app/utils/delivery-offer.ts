import { DELIVERY_ROUTES, type DeliveryRoute, type PublicSchemaDeliveryOffer } from '../types/delivery';

/** The offer of a form without delivery settings: the citizen is not asked, the backend uses `portal`. */
export const UNCONFIGURED_DELIVERY_OFFER: Readonly<PublicSchemaDeliveryOffer> = Object.freeze({ configured: false, routes: [], default: null });

function unconfigured(): PublicSchemaDeliveryOffer {
    return { configured: false, routes: [], default: null };
}

/**
 * Normalizes a delivery offer (`{configured, routes, default}`). Anything
 * malformed is the unconfigured offer: an unknown or repeated route, a
 * default outside the routes, or a configured offer without routes. The
 * routes keep the backend order (`DeliveryRoute::ROUTES`).
 */
export function normalizeDeliveryOffer(value: unknown): PublicSchemaDeliveryOffer {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return unconfigured();
    const offer = value as Record<string, unknown>;
    if (offer.configured !== true) return unconfigured();
    const routes = offer.routes;
    if (!Array.isArray(routes) || routes.length === 0 || new Set(routes).size !== routes.length) return unconfigured();
    if (routes.some(route => !(DELIVERY_ROUTES as readonly unknown[]).includes(route))) return unconfigured();
    const fallback = offer.default;
    if (typeof fallback !== 'string' || !routes.includes(fallback)) return unconfigured();
    return {
        configured: true,
        routes: DELIVERY_ROUTES.filter(route => routes.includes(route)),
        default: fallback as DeliveryRoute
    };
}

/**
 * Reads the delivery offer of a public schema response (`deliveryOffer`
 * next to the consent offer keys of GET /api/schema/:id).
 */
export function publicSchemaDeliveryOffer(attributes: unknown): PublicSchemaDeliveryOffer {
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return unconfigured();
    return normalizeDeliveryOffer((attributes as Record<string, unknown>).deliveryOffer);
}

/** The citizen is asked only when the form offers a real choice. */
export function deliveryOfferHasChoice(offer: PublicSchemaDeliveryOffer | null | undefined): boolean {
    return offer?.configured === true && offer.routes.length > 1;
}
