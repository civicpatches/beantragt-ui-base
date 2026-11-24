/**
 * GET /api/applicant/my-data
 *
 * Returns the authenticated citizen's profile data and application count.
 * Used by the GDPR self-service page (/meine-daten) for Art. 15 DSGVO.
 *
 * Proxies to Drupal JSON:API with session cookie forwarding.
 */
import { setPrivateNoStore } from '../../utils/request-security';

const FORM_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

interface CitizenApplicationSummary {
    createdAt?: string
}

interface AuthStatusData {
    authenticated?: boolean
    user?: {
        uid?: number | string
        email?: string
    }
}

interface ApplicantProfileData {
    id?: unknown
    scopeLabel?: string | null
    email?: string
    fullName?: string
    firstName?: string
    lastName?: string
    phone?: string
    address?: string
    street?: string
    postalCode?: string
    city?: string
    createdAt?: string
    consentAt?: string | null
    consentTextVersion?: string | null
    consentScopeLabel?: string | null
    bankConsentAt?: string | null
    bankConsentTextVersion?: string | null
    bankConsentScopeLabel?: string | null
    consentWithdrawnAt?: string | null
    bankConsentWithdrawnAt?: string | null
    loginConfirmed?: LoginConfirmedData | null
    birthdate?: string
    gender?: string
    nationality?: string
    maritalStatus?: string
}

interface LoginConfirmedData {
    provider?: unknown
    providerLabel?: unknown
    at?: unknown
    fields?: unknown
}

const LOGIN_CONFIRMED_FIELDS = ['email', 'fullName', 'firstName', 'lastName', 'birthdate'] as const;

/**
 * Keeps only the documented shape of the login confirmation.
 */
function loginConfirmed(value: LoginConfirmedData | null | undefined) {
    if (!value || typeof value !== 'object') return undefined;
    const fields = Array.isArray(value.fields)
        ? value.fields.filter((field): field is typeof LOGIN_CONFIRMED_FIELDS[number] =>
            typeof field === 'string' && (LOGIN_CONFIRMED_FIELDS as readonly string[]).includes(field))
        : [];
    const provider = typeof value.provider === 'string' ? value.provider : '';
    if (!provider || !fields.length) return undefined;
    return {
        provider,
        providerLabel: typeof value.providerLabel === 'string' && value.providerLabel ? value.providerLabel : provider,
        at: typeof value.at === 'string' && value.at ? value.at : undefined,
        fields
    };
}

interface ApplicantProfileResponse {
    data?: ApplicantProfileData | null
    profiles?: unknown
}

/**
 * Maps one Drupal profile to the documented page contract.
 */
function mapProfile(item: ApplicantProfileData, accountEmail: string | undefined) {
    const id = typeof item.id === 'number' && Number.isInteger(item.id) && item.id > 0 ? item.id : undefined;
    return {
        ...(id ? { id } : {}),
        scopeLabel: item.scopeLabel || undefined,
        email: item.email || accountEmail || '',
        fullName: item.fullName || undefined,
        phone: item.phone || undefined,
        address: item.address || undefined,
        street: item.street || undefined,
        postalCode: item.postalCode || undefined,
        city: item.city || undefined,
        createdAt: item.createdAt || undefined,
        consentAt: item.consentAt || undefined,
        consentTextVersion: item.consentTextVersion || undefined,
        consentScopeLabel: item.consentScopeLabel || undefined,
        bankConsentAt: item.bankConsentAt || undefined,
        bankConsentTextVersion: item.bankConsentTextVersion || undefined,
        bankConsentScopeLabel: item.bankConsentScopeLabel || undefined,
        consentWithdrawnAt: item.consentWithdrawnAt || undefined,
        bankConsentWithdrawnAt: item.bankConsentWithdrawnAt || undefined,
        loginConfirmed: loginConfirmed(item.loginConfirmed)
    };
}

/**
 * Maps the profile of a form's Stelle, which also carries first and last
 * name and the registered identity values for the prefill (Drupal sends
 * them only for ?form=).
 */
function mapPrefillProfile(item: ApplicantProfileData, accountEmail: string | undefined) {
    return {
        ...mapProfile(item, accountEmail),
        firstName: typeof item.firstName === 'string' && item.firstName ? item.firstName : undefined,
        lastName: typeof item.lastName === 'string' && item.lastName ? item.lastName : undefined,
        birthdate: typeof item.birthdate === 'string' && item.birthdate ? item.birthdate : undefined,
        gender: typeof item.gender === 'string' && item.gender ? item.gender : undefined,
        nationality: typeof item.nationality === 'string' && item.nationality ? item.nationality : undefined,
        maritalStatus: typeof item.maritalStatus === 'string' && item.maritalStatus ? item.maritalStatus : undefined
    };
}

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);
    requireAuth(event);

    const cookieHeader = getHeader(event, 'cookie') || '';

    try {
        const authResponse = await drupalSessionRequest(event, '/auth/status', {
            headers: buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader })
        });

        const authData = await authResponse.json<AuthStatusData>();

        if (!authData?.authenticated || !authData?.user?.uid) {
            throw createSafeError({
                statusCode: 401,
                message: 'errors.citizen.notAuthenticated',
                data: { code: 'errors.citizen.notAuthenticated' }
            });
        }

        const email = String(authData.user.email || '').toLowerCase();
        if (!email) {
            throw createSafeError({
                statusCode: 401,
                message: 'errors.citizen.notAuthenticated',
                data: { code: 'errors.citizen.notAuthenticated' }
            });
        }

        // A form asks for the profile of its own Stelle (prefill); Drupal
        // resolves the Stelle from the form and answers data: null when the
        // citizen has no profile there. Without a form, data is the primary
        // profile for the overview.
        const formQuery = getQuery(event).form;
        const formId = typeof formQuery === 'string' ? formQuery : '';
        if (formId && !FORM_UUID_PATTERN.test(formId)) {
            throw createSafeError({
                statusCode: 400,
                message: 'errors.citizen.loadFailed',
                data: { code: 'errors.citizen.loadFailed' }
            });
        }
        const profilePath = formId
            ? `/api/citizen/applicant-profile?form=${encodeURIComponent(formId)}`
            : '/api/citizen/applicant-profile';

        const [profileResponse, applicationsPayload] = await Promise.all([
            drupalSessionRequest(event, profilePath, {
                headers: buildDrupalRequestHeaders(event, {
                    accept: 'application/json',
                    cookieHeader
                })
            }),
            drupalSessionRequest(event, '/api/citizen/applications', {
                headers: buildDrupalRequestHeaders(event, { accept: 'application/json', cookieHeader })
            }).then(async (response) => {
                if (!response.ok) {
                    throw createSafeError({
                        statusCode: response.status,
                        message: 'errors.applications.loadFailed',
                        data: { code: 'errors.applications.loadFailed' }
                    });
                }
                return await response.json<{ applications?: CitizenApplicationSummary[] }>();
            })
        ]);

        if (!profileResponse.ok) {
            const payload = await profileResponse.json().catch(() => null) as {
                error?: { code?: string }
            } | null;
            const code = payload?.error?.code || 'errors.citizen.loadFailed';
            throw createSafeError({
                statusCode: profileResponse.status,
                message: code,
                data: { code }
            });
        }

        // Parse the requested profile (the form's Stelle, else the primary
        // one) and every own profile, one per Stelle, for the consents and
        // their withdrawal.
        const profileJson = await profileResponse.json<ApplicantProfileResponse>();
        const item = profileJson.data;
        const profile = item
            ? (formId ? mapPrefillProfile(item, authData.user.email) : mapProfile(item, authData.user.email))
            : null;
        const profiles = Array.isArray(profileJson.profiles)
            ? profileJson.profiles
                .filter((entry): entry is ApplicantProfileData => Boolean(entry) && typeof entry === 'object')
                .map(entry => mapProfile(entry, authData.user?.email))
                .filter(entry => entry.id !== undefined)
            : [];

        const items = applicationsPayload.applications || [];
        const applicationCount = items.length;
        let lastActivity: string | undefined;
        const latestApplication = items[0];
        if (latestApplication) {
            lastActivity = latestApplication.createdAt || undefined;
        }

        return {
            profile,
            profiles,
            applicationCount,
            lastActivity
        };
    } catch (e: unknown) {
        if (e && typeof e === 'object' && 'statusCode' in e) {
            throw e;
        }

        console.error('[applicant/my-data] Error:', e instanceof Error ? e.message : e);
        throw createSafeError({
            statusCode: 500,
            message: 'errors.citizen.loadFailed',
            data: { code: 'errors.citizen.loadFailed' }
        });
    }
});
