/**
 * POST /api/confirm
 *
 * Same-origin Nuxt proxy for public application email confirmation.
 */
import type { H3Event } from 'h3';
import { readSubmissionReceipt } from '#shared/submission-receipt';
import { normalizePublicJurisdictionSlug, normalizePublicOrganisationSlug } from '~~/app/utils/public-jurisdiction-config';
import { requireSameOriginRequest, setPrivateNoStore } from '../utils/request-security';
import { proxyPublicConfirmationRequest } from '../utils/public-confirmation-proxy';
import { checkRateLimit, getClientIp } from '../utils/rate-limit';

function isRateLimitError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && (error as { statusCode?: unknown }).statusCode === 429);
}

function rateLimitResponse(event: H3Event): { error: { code: 'rate_limit.exceeded' } } {
    setResponseStatus(event, 429);
    return { error: { code: 'rate_limit.exceeded' } };
}

function projectConfirmation(payload: unknown) {
    if (!payload || typeof payload !== 'object') return {};
    const { status, referenceNumber: reference, jurisdictionSlug: jurisdiction, organisationSlug: organisation, receipt }
        = payload as Record<string, unknown>;
    if (status !== 'confirmed' && status !== 'already_confirmed') return {};

    const referenceNumber = typeof reference === 'string' ? reference.trim() : '';
    const jurisdictionSlug = normalizePublicJurisdictionSlug(jurisdiction);
    const organisationSlug = jurisdictionSlug ? normalizePublicOrganisationSlug(organisation) : null;
    return {
        status,
        referenceNumber: referenceNumber || null,
        jurisdictionSlug,
        ...(organisationSlug ? { organisationSlug } : {}),
        receipt: readSubmissionReceipt(receipt, referenceNumber)
    };
}

export default defineEventHandler(async (event) => {
    requireSameOriginRequest(event);
    setPrivateNoStore(event);

    const body = await readBody<{ token?: unknown }>(event);
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    try {
        checkRateLimit(getClientIp(event), 'application_confirm', event);
    } catch (error: unknown) {
        if (isRateLimitError(error)) return rateLimitResponse(event);
        throw error;
    }

    return proxyPublicConfirmationRequest(
        event,
        '/api/v1/public/applications/confirm',
        { token },
        [200, 404, 429],
        'application-confirm',
        projectConfirmation
    );
});
