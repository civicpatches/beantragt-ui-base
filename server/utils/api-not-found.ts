import type { H3Event } from 'h3';

export function apiNotFound(event: H3Event) {
    setResponseStatus(event, 404);
    setPrivateNoStore(event);
    return { error: { code: 'route.not_found', message: 'API route not found.' } };
}
