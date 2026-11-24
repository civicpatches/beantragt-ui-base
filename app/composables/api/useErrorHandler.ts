/**
 * Error Handler Composable
 *
 * Centralized API error handling with i18n-ready error keys,
 * structured validation error parsing from Drupal JSON:API,
 * and rate limit wait-time extraction.
 *
 * Adapted from Mark-a-Spot's useErrorHandler for beantragt.ai.
 * Differences from MaS:
 * - No duplicate report detection (not applicable)
 * - No geolocation/jurisdiction errors (not applicable)
 * - German fallback messages (municipal platform)
 * - Form field mapping adapted for beantragt entities
 */
import { useGlobalMaintenance } from '~/composables/useGlobalMaintenance';

type UnauthorizedApiErrorHandler = (error: unknown, route: ReturnType<typeof useRoute>) => boolean;

let unauthorizedApiErrorHandler: UnauthorizedApiErrorHandler | null = null;

/**
 * Optional extension point for staff-only 401 handling.
 *
 * The base stays independent from Layer 3. The Pro layer registers its staff
 * redirect behavior from a plugin when that layer is enabled.
 */
export function registerUnauthorizedApiErrorHandler(handler: UnauthorizedApiErrorHandler | null): void {
    unauthorizedApiErrorHandler = handler;
}

/** Structured error entry for display in forms or toast messages. */
export interface FormError {
    field: string
    message: string
    code?: string
    meta?: Record<string, unknown>
}

/** Overall error state exposed to components. */
export interface ErrorState {
    message: string
    errors: FormError[]
    isVisible: boolean
    meta: Record<string, unknown>
}

/** API Error class with i18n error key. */
export class ApiError extends Error {
    public errorKey?: string;

    constructor(
        public status: number,
        public statusText: string,
        public data: unknown
    ) {
        type ApiErrorData = {
            data?: { errors?: Array<{ detail?: string, title?: string }> }
            errors?: Array<{ detail?: string, title?: string }>
        };
        const errorData = (data as ApiErrorData)?.data || data as { errors?: Array<{ detail?: string, title?: string }> };
        let errorDetail = errorData?.errors?.[0]?.detail
          || errorData?.errors?.[0]?.title;

        const errorKey = API_ERROR_KEYS[status];

        // German fallback messages for logging (components should use errorKey for i18n)
        if (!errorDetail) {
            switch (status) {
                case 429:
                    errorDetail = 'Zu viele Anfragen. Bitte warten Sie einen Moment.';
                    break;
                case 401:
                    errorDetail = 'Nicht angemeldet. Bitte melden Sie sich erneut an.';
                    break;
                case 403:
                    errorDetail = 'Zugriff verweigert.';
                    break;
                case 404:
                    errorDetail = 'Ressource nicht gefunden.';
                    break;
                case 422:
                    errorDetail = 'Eingabefehler. Bitte pruefen Sie Ihre Angaben.';
                    break;
                case 500:
                    errorDetail = 'Serverfehler. Bitte versuchen Sie es spaeter erneut.';
                    break;
                case 503:
                    errorDetail = 'Service voruebergehend nicht erreichbar.';
                    break;
                default:
                    errorDetail = `API-Fehler: ${status}`;
            }
        }

        super(errorDetail);
        this.name = 'ApiError';
        this.errorKey = errorKey;
        this.data = data;
    }
}

/** HTTP status to i18n translation key mapping. */
export const API_ERROR_KEYS: Record<number, string> = {
    429: 'errors.api.rateLimit',
    401: 'errors.api.unauthorized',
    403: 'errors.api.forbidden',
    404: 'errors.api.notFound',
    422: 'errors.api.validation',
    500: 'errors.api.serverError',
    503: 'errors.api.serviceUnavailable'
};

export const useErrorHandler = () => {
    const maintenance = useGlobalMaintenance();
    const errorState = ref<ErrorState>({
        message: 'Eingabefehler',
        errors: [],
        isVisible: false,
        meta: {}
    });

    /**
   * Process API errors from various sources and formats.
   * Handles rate limits, validation errors, and generic failures.
    */
    const processApiErrors = (error: unknown) => {
        const err = error as Record<string, unknown>;
        const status = (err.statusCode as number)
          || (err.status as number)
          || (err.response as Record<string, unknown>)?.status as number
          || (err.data as Record<string, unknown>)?.statusCode as number;
        if (status === 401) {
            const route = useRoute();
            if (unauthorizedApiErrorHandler?.(error, route)) {
                return;
            }
        }

        if (status === 503) {
            void maintenance.handleRequestError(error);
        }

        if (errorState.value.isVisible) return;

        errorState.value = {
            message: 'Eingabefehler',
            errors: [],
            isVisible: true,
            meta: {}
        };

        // Rate limit errors (429)
        if (status === 429) {
            const errorMessage = (err as { originalMessage?: string }).originalMessage
              || (err as { message?: string }).message
              || 'Zu viele Anfragen';

            const waitTimeMatch = String(errorMessage).match(/(\d+)\s*(?:seconds|Sekunden)/i);
            const waitTime = waitTimeMatch?.[1] ? parseInt(waitTimeMatch[1]) : null;

            errorState.value.message = 'Zu viele Anfragen';

            if (waitTime) {
                errorState.value.meta = { seconds: waitTime, type: 'rate_limit' };
            }

            errorState.value.errors.push({
                field: 'general',
                message: waitTime
                    ? `Bitte warten Sie ${waitTime} Sekunden und versuchen Sie es erneut.`
                    : 'Bitte warten Sie einen Moment und versuchen Sie es erneut.',
                code: 'rate_limit',
                meta: { seconds: waitTime }
            });

            return;
        }

        // Structured API errors (including 422 validation)
        const apiErrors = (err.response as Record<string, unknown>)?.data
            ? ((err.response as Record<string, unknown>).data as Record<string, unknown>)?.errors as Array<Record<string, unknown>>
            : (err.data as Record<string, unknown>)?.errors as Array<Record<string, unknown>>;

        if (apiErrors?.length) {
            if (status === 422) {
                errorState.value.message = 'Bitte pruefen Sie Ihre Eingaben.';
            }

            for (const apiError of apiErrors) {
                const source = apiError.source as Record<string, string> | undefined;
                const fieldMatch = source?.pointer?.match(/\/data\/attributes\/([^/]+)/);
                let field: string = fieldMatch?.[1] ?? 'general';

                // Strip nested paths like "field_data.0.name" -> "field_data"
                if (field.includes('.')) {
                    field = field.split('.')[0] ?? field;
                }

                let detail = (apiError.detail as string) || (apiError.title as string) || 'Unbekannter Fehler';

                // Strip field path prefix from message
                const fieldPrefixMatch = detail.match(/^field_[a-z_]+(\.\d+\.[a-z_]+)?:\s*/i);
                if (fieldPrefixMatch) {
                    detail = detail.slice(fieldPrefixMatch[0].length);
                }

                addFormattedError(field, detail);
            }

            return;
        }

        // Generic error fallback
        const errorMessage = String(err.message || err).replace('ApiError: ', '');

        if (/required|fehlt|pflichtfeld/i.test(errorMessage)) {
            const fieldMatch = errorMessage.match(/^([^:]+):/);
            const field = fieldMatch?.[1]?.trim() ?? 'general';
            errorState.value.errors.push({
                field,
                message: `Pflichtfeld: ${field}`,
                code: 'required_field'
            });
        } else if (/email|e-mail/i.test(errorMessage)) {
            errorState.value.errors.push({
                field: 'email',
                message: 'Bitte geben Sie eine gueltige E-Mail-Adresse ein.',
                code: 'email_error'
            });
        } else {
            errorState.value.errors.push({
                field: 'general',
                message: 'Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.',
                code: 'error'
            });
        }
    };

    const addFormattedError = (field: string, message: string) => {
    // Clean field name by stripping "field_" prefix to prevent duplicates
        const cleanField = field.replace(/^field_/, '');

        const fieldMap: Record<string, string> = {
            data: 'field_data',
            schema: 'field_schema',
            applicant_email: 'email',
            crm_data: 'field_crm_data',
            workflow_status: 'field_workflow_status',
            reference_number: 'field_reference_number'
        };

        const normalizedField = fieldMap[cleanField] || field;

        errorState.value.errors.push({
            field: normalizedField,
            message,
            code: 'validation_error'
        });
    };

    const clearErrors = () => {
        errorState.value = {
            message: 'Eingabefehler',
            errors: [],
            isVisible: false,
            meta: {}
        };
    };

    return {
        errorState,
        processApiErrors,
        clearErrors,
        addFormattedError
    };
};
