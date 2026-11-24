/**
 * Load state for settings pages.
 *
 * A settings page that cannot load its data must tell the true reason: a
 * refused load (the server said "not for you here") shows the reason once,
 * without "Erneut versuchen" and without anything editable; a technical
 * failure keeps the error with retry where a retry can help. A page that was
 * never loaded is never "dirty", so leave guards stay quiet.
 *
 * The reason follows the server answer, never a guess from the role:
 *  - 409 with `integration.jurisdiction_workspace_required`: the integrations
 *    proxy refuses every organisation workspace (integrations belong to the
 *    municipality).
 *  - 403 with `errors.auth.accessDenied`: the Nuxt role gate (`requireAdmin`).
 *  - 403 with `integration.access_denied`: Drupal's integration controller
 *    (`IntegrationController::handle`) refuses an account without the right
 *    to administer integration connections or mappings.
 *  - 403 with one of the codes the page names in `refusalCodes`: the Drupal
 *    access check of a municipality setting, passed through by the proxy
 *    with its fallback code. Drupal grants these endpoints only to admins of
 *    the municipality (`JurisdictionConfigController::accessCheck`,
 *    `AdminContentController::accessCheck`). The proxy carries no field that
 *    says why Drupal refused; the workspace type only picks the wording.
 *
 * Every other answer is a technical failure. A bare 409 is never a refusal:
 * integrations use it for conflicts, workflow statuses for the default status.
 */
import { computed, ref } from 'vue';

export type SettingsRefusal
    /** Drupal refused a municipality setting while the person works in an organisation. */
    = | 'municipalityMaintains'
    /** Drupal refused a municipality setting in the municipality workspace itself. */
      | 'municipalityAdmin'
    /** Integrations answer only in the municipality workspace. */
      | 'municipalityWorkspace'
    /** The Nuxt role gate refused: no administration role at all. */
      | 'adminOnly'
    /** Drupal refused integrations: the account lacks the integration right. */
      | 'integrationRight';

export type SettingsLoadFailure
    = | { kind: 'session' }
      | { kind: 'refused', refusal: SettingsRefusal }
      | { kind: 'technical', retryable: boolean };

export interface SettingsLoadClassifyOptions {
    /** Fallback codes with which the page's proxy passes a Drupal 403 through. */
    refusalCodes?: readonly string[]
    /** Type of the current workspace; only picks the wording of a refusal. */
    workspaceType?: 'jurisdiction' | 'organisation' | null
}

const ROLE_GATE_CODE = 'errors.auth.accessDenied';
const JURISDICTION_WORKSPACE_CODE = 'integration.jurisdiction_workspace_required';
const INTEGRATION_RIGHT_CODE = 'integration.access_denied';

function errorStatus(error: unknown): number | null {
    const err = (error ?? {}) as {
        statusCode?: unknown
        status?: unknown
        response?: { status?: unknown }
        data?: { statusCode?: unknown }
    };
    const status = err.statusCode ?? err.status ?? err.response?.status ?? err.data?.statusCode;
    return typeof status === 'number' ? status : null;
}

/** The safe error code a Nuxt proxy sets (`data.code`, nested once by `$fetch`). */
export function settingsErrorCode(error: unknown): string | null {
    const err = (error ?? {}) as { data?: { code?: unknown, data?: { code?: unknown } } };
    const code = err.data?.data?.code ?? err.data?.code;
    return typeof code === 'string' ? code : null;
}

/** A retry can help after a network failure, a timeout, a rate limit or a server error. */
function isRetryable(status: number | null): boolean {
    return status === null || status === 408 || status === 429 || status >= 500;
}

export function classifySettingsLoadFailure(error: unknown, options: SettingsLoadClassifyOptions = {}): SettingsLoadFailure {
    const status = errorStatus(error);
    const code = settingsErrorCode(error);
    if (status === 401) return { kind: 'session' };
    if (status === 409 && code === JURISDICTION_WORKSPACE_CODE) {
        return { kind: 'refused', refusal: 'municipalityWorkspace' };
    }
    if (status === 403 && code === ROLE_GATE_CODE) {
        return { kind: 'refused', refusal: 'adminOnly' };
    }
    if (status === 403 && code === INTEGRATION_RIGHT_CODE) {
        return { kind: 'refused', refusal: 'integrationRight' };
    }
    if (status === 403 && code !== null && options.refusalCodes?.includes(code)) {
        return {
            kind: 'refused',
            refusal: options.workspaceType === 'organisation' ? 'municipalityMaintains' : 'municipalityAdmin'
        };
    }
    return { kind: 'technical', retryable: isRetryable(status) };
}

export type SettingsLoadPhase = 'loading' | 'ready' | 'refused' | 'failed';

/**
 * Reactive wrapper around the classifier for one load of a page (or of one
 * section of a page that is only partly available).
 */
export function useSettingsLoadState(options: { refusalCodes?: readonly string[] } = {}) {
    const workspaceContext = useWorkspaceContext() as Partial<ReturnType<typeof useWorkspaceContext>>;
    const phase = ref<SettingsLoadPhase>('loading');
    const refusal = ref<SettingsRefusal | null>(null);
    const retryable = ref(true);

    const loaded = computed(() => phase.value === 'ready');
    const refused = computed(() => phase.value === 'refused');
    const failed = computed(() => phase.value === 'failed');

    function begin() {
        phase.value = 'loading';
        refusal.value = null;
        retryable.value = true;
    }

    function succeed() {
        phase.value = 'ready';
        refusal.value = null;
    }

    /**
     * Record a failed load. Returns the kind so the page can keep its own
     * message for a technical failure; a session failure leaves the page as
     * it is (the staff fetch already leads to the login).
     */
    function fail(error: unknown): SettingsLoadFailure['kind'] {
        const failure = classifySettingsLoadFailure(error, {
            refusalCodes: options.refusalCodes,
            workspaceType: workspaceContext.currentWorkspace?.value?.type ?? null
        });
        if (failure.kind === 'refused') {
            phase.value = 'refused';
            refusal.value = failure.refusal;
        } else if (failure.kind === 'technical') {
            phase.value = 'failed';
            retryable.value = failure.retryable;
        }
        return failure.kind;
    }

    /** A failure the page found itself (for example no workspace selected). */
    function failLocally(canRetry = true) {
        phase.value = 'failed';
        refusal.value = null;
        retryable.value = canRetry;
    }

    return { phase, refusal, retryable, loaded, refused, failed, begin, succeed, fail, failLocally };
}

/** Codes the settings section proxy uses when it passes a Drupal answer through. */
export const SETTINGS_SECTION_REFUSAL_CODES = ['errors.admin.settingsLoadFailed'] as const;
/** Codes the content and document proxies use when they pass a Drupal answer through. */
export const CONTENT_REFUSAL_CODES = ['errors.admin.contentLoadFailed', 'errors.admin.documentLoadFailed'] as const;
