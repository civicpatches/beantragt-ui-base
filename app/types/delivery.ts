/**
 * Delivery route of an application and of every provided response
 * (stage 1: route, postal duty, evidence).
 *
 * Values mirror the backend constants exactly: `DeliveryRoute::ROUTES`,
 * `::SOURCES`, `::CHANNELS` (beantragt_application) and
 * `DeliveryRules::REASONS` (beantragt_delivery). Every enum below has a de
 * and en label (tests/unit/types/delivery-enums.test.ts).
 */
import type { ExternalResponse } from './external-response';

export const DELIVERY_ROUTES = ['portal', 'postal', 'bundid'] as const;
export type DeliveryRoute = typeof DELIVERY_ROUTES[number];

/** Who set the current route: citizen at submit, batch manifest, form default or staff. */
export const DELIVERY_SOURCES = ['public_submit', 'manifest', 'form_default', 'staff'] as const;
export type DeliverySource = typeof DELIVERY_SOURCES[number];

/** Why provision turned a route into post (`DeliveryRules::REASONS`). */
export const ROUTE_REASONS = ['chosen_postal', 'no_digital_option', 'postbox_unavailable', 'decision_postal_only'] as const;
export type RouteReason = typeof ROUTE_REASONS[number];

/** Why intake fell back to the form default (`route_chosen.reason`). */
export const CHOICE_REASONS = ['not_configured', 'not_requested', 'not_offered'] as const;
export type ChoiceReason = typeof CHOICE_REASONS[number];

/** How a citizen's request to change the route reached the authority. */
export const DELIVERY_CHANNELS = ['letter', 'phone', 'email', 'in_person', 'other'] as const;
export type DeliveryChannel = typeof DELIVERY_CHANNELS[number];

export const DELIVERY_EVENTS = ['route_chosen', 'route_changed'] as const;
export type DeliveryEventKind = typeof DELIVERY_EVENTS[number];

export function isDeliveryRoute(value: unknown): value is DeliveryRoute {
    return typeof value === 'string' && (DELIVERY_ROUTES as readonly string[]).includes(value);
}

/**
 * Offer of a public form (`deliveryOffer` of GET /api/schema/:id). An
 * unconfigured or malformed offer is `{configured: false, routes: [], default: null}`:
 * the citizen is not asked and the backend uses `portal`.
 */
export interface PublicSchemaDeliveryOffer {
    configured: boolean
    routes: DeliveryRoute[]
    default: DeliveryRoute | null
}

/** Effective route of one kind of document (`DeliveryRules::effectiveRoute()`). */
export interface DeliveryRouteDecision {
    route: DeliveryRoute
    reason: RouteReason | null
}

/** `ExternalResponseService::deliveryPreview()`: what a release would do. */
export interface DeliveryPreview {
    decision: DeliveryRouteDecision
    communication: DeliveryRouteDecision
}

/** One event of the application's delivery record, as the staff GET projects it. */
export interface ApplicationDeliveryEvent {
    event: DeliveryEventKind
    at: number
    receivedAt: number | null
    route: DeliveryRoute
    source: DeliverySource
    reason: ChoiceReason | null
    channel: DeliveryChannel | null
    byName: string | null
}

/** One provided response (docgen release or case-system reply) with its evidence. */
export interface ApplicationDeliveryDocument {
    responseId: string
    title: string
    isDecision: boolean
    providedAt: number | null
    /** Effective route fixed at provision; `''` for rows provided before stage 1. */
    route: DeliveryRoute | ''
    reason: RouteReason | null
    notificationState: ExternalResponse['notificationState']
    notificationSentAt: number | null
    retrievedAt: number | null
    postalDueAt: number | null
    postalHandedOverAt: number | null
    postalHandedOverByName: string | null
}

/** GET /api/admin/applications/:id/delivery (staff only, scoped). */
export interface ApplicationDelivery {
    route: DeliveryRoute
    /** NULL for an application without a delivery record. */
    source: DeliverySource | null
    chosenAt: number | null
    offered: DeliveryRoute[]
    routeOptions: DeliveryRoute[]
    canEdit: boolean
    /** NULL only when the backend sent an unusable preview. */
    preview: DeliveryPreview | null
    events: ApplicationDeliveryEvent[]
    documents: ApplicationDeliveryDocument[]
}

/** POST /api/admin/applications/:id/delivery: the GET payload plus whether anything changed. */
export interface ApplicationDeliveryChange extends ApplicationDelivery {
    changed: boolean
}

export interface ApplicationDeliveryChangeBody {
    route: DeliveryRoute
    receivedAt?: number
    channel: DeliveryChannel
}

export interface ApplicationDeliveryResponse<T extends ApplicationDelivery = ApplicationDelivery> {
    data: T
}
