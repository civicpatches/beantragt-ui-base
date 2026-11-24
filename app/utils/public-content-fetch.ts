/**
 * Status codes on which a public notes or leaflets call is repeated once: `$fetch`'s own list without 429. The backend
 * counts these calls per visitor address; when it refuses one with 429, asking again at once only adds load (sweep of
 * the demo candidate). Other failures keep the usual single retry.
 */
export const PUBLIC_CONTENT_RETRY_STATUS_CODES = [408, 409, 425, 500, 502, 503, 504];
