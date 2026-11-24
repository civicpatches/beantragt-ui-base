/**
 * Barrel export for API composables.
 *
 * Usage:
 *   import { useErrorHandler, ApiError, API_ERROR_KEYS } from '~/composables/api'
 */
export { useErrorHandler, ApiError, API_ERROR_KEYS } from './useErrorHandler';
export type { ErrorState, FormError } from './useErrorHandler';
