/**
 * API Error Message Resolver
 *
 * Resolves a server API error into a localized, human-readable string.
 *
 * Server routes follow the Mark-a-Spot pattern: every error carries a stable
 * i18n key in `data.code` (e.g. `errors.submit.formNotFound`). The client
 * renders that key with `t()` instead of displaying raw German prose from the
 * `message` field. Interpolation params travel in `data` alongside the code.
 *
 * Resolution order:
 * 1. `data.code` starts with an i18n-safe prefix -> `t(code, data)`, with a
 *    backend validation detail appended as plain-text precision when present
 * 2. Backend validation detail -> plain text
 * 3. Shared messages for 401, 429 and 503
 * 4. Contextual fallback, if supplied
 * 5. Other known HTTP status messages, then `t('errors.generic')`
 *
 * Must be called from a `<script setup>` context (uses `useI18n`).
 */
import { API_ERROR_KEYS } from './useErrorHandler';
import { useGlobalMaintenance } from '~/composables/useGlobalMaintenance';

/** Shape of an API error as surfaced by `$fetch` / `useFetch`. */
interface ApiErrorLike {
    statusCode?: number
    status?: number
    data?: {
        code?: unknown
        detail?: unknown
        statusCode?: number
        data?: {
            code?: unknown
            detail?: unknown
            statusCode?: number
            [key: string]: unknown
        }
        [key: string]: unknown
    }
    response?: { status?: number }
}

type ApiErrorTranslator = (key: string, params?: Record<string, unknown>) => string;

export function resolveApiErrorMessageWithTranslator(
    e: unknown,
    fallbackKey: string | undefined,
    t: ApiErrorTranslator
): string {
    const err = (e ?? {}) as ApiErrorLike;
    const envelope = err.data;
    const nestedData = envelope?.data && typeof envelope.data === 'object' ? envelope.data : undefined;
    const data = nestedData ?? envelope;
    const detail = typeof data?.detail === 'string' && data.detail.trim()
        ? data.detail.trim()
        : typeof envelope?.detail === 'string' && envelope.detail.trim()
            ? envelope.detail.trim()
            : undefined;

    // 1. Stable i18n key carried in data.code
    const code = data?.code;
    if (typeof code === 'string' && /^(errors\.|delivery\.|integration\.|fit_connect\.|docgen\.|bulk\.|nachreichung\.)/u.test(code)) {
        // Passing `data` lets interpolation params (status, size, ...) through.
        const localized = t(code, data as Record<string, unknown>);
        return detail && detail !== localized
            ? `${localized} ${detail}`
            : localized;
    }

    // 2. Drupal validation details are already localized and remain plain text.
    if (detail) return detail;

    // 3. Map HTTP status via the shared API_ERROR_KEYS table
    const status = err.statusCode
      ?? err.status
      ?? err.response?.status
      ?? data?.statusCode
      ?? envelope?.statusCode;
    if (status === 401 || status === 429 || status === 503) return t(API_ERROR_KEYS[status]!);

    return t(fallbackKey || (typeof status === 'number' && API_ERROR_KEYS[status]) || 'errors.generic');
}

/**
 * Resolve an API error to a localized message string.
 *
 * @param e            The error thrown by `$fetch` / `useFetch`.
 * @param fallbackKey  Optional i18n key for a context-specific fallback,
 *                     used only when the error carries neither a known
 *                     `errors.*` code nor a shared session, rate-limit or availability status. When
 *                     omitted, known statuses use their shared message.
 */
export const useApiErrorMessage = () => {
    const { t } = useI18n();
    const maintenance = useGlobalMaintenance();

    const resolveApiErrorMessage = (e: unknown, fallbackKey?: string): string => {
        void maintenance.handleRequestError(e);
        return resolveApiErrorMessageWithTranslator(e, fallbackKey, t);
    };

    return { resolveApiErrorMessage };
};
