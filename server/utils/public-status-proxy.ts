/**
 * Helpers for Nuxt-to-Drupal public status proxy calls.
 */
import { createHash } from 'node:crypto';
import { getServiceAuthHeader } from './auth';

/**
 * Builds a cookie-free identifier Drupal may trust for public flood control.
 */
export function serviceProxyRateLimitIdentifier(scope: string, ip: string): string {
    return createHash('sha256')
        .update(`${scope}:${ip || 'unknown'}`)
        .digest('hex')
        .slice(0, 32);
}

/**
 * Builds a cookie-free identifier Drupal may trust for public status flood control.
 */
export function publicStatusProxyRateLimitIdentifier(ip: string): string {
    return serviceProxyRateLimitIdentifier('public-status', ip);
}

/**
 * Shared service headers for trusted Nuxt proxy requests.
 */
export function serviceProxyHeaders(scope: string, ip: string): Record<string, string> {
    return {
        'X-Beantragt-Service-Authorization': getServiceAuthHeader(),
        'X-Beantragt-Rate-Limit-Identifier': serviceProxyRateLimitIdentifier(scope, ip)
    };
}

/**
 * Shared service headers for public status proxy requests.
 */
export function publicStatusProxyHeaders(ip: string): Record<string, string> {
    return serviceProxyHeaders('public-status', ip);
}
