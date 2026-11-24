import type { H3Event } from 'h3';

const MAX_GEOCODING_BODY_BYTES = 2_048;

function bodyError(statusCode: 400 | 413) {
    const code = statusCode === 413
        ? 'errors.geocoding.requestTooLarge'
        : 'errors.geocoding.invalidQuery';
    return createSafeError({ statusCode, message: code, data: { code } });
}

function readBoundedRawBody(event: H3Event): Promise<string> {
    return new Promise((resolve, reject) => {
        const request = event.node.req;
        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;

        request.on('data', (chunk: Buffer | string) => {
            if (settled) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > MAX_GEOCODING_BODY_BYTES) {
                settled = true;
                chunks.length = 0;
                request.resume();
                reject(bodyError(413));
                return;
            }
            chunks.push(buffer);
        });
        request.once('end', () => {
            if (settled) return;
            settled = true;
            resolve(Buffer.concat(chunks, size).toString('utf8'));
        });
        request.once('aborted', () => {
            if (settled) return;
            settled = true;
            reject(bodyError(400));
        });
        request.once('error', () => {
            if (settled) return;
            settled = true;
            reject(bodyError(400));
        });
    });
}

/** Reads the small geocoding JSON payload without accepting an unbounded body. */
export async function readGeocodingRequestBody<T>(event: H3Event): Promise<T> {
    const contentLengthHeader = getHeader(event, 'content-length');
    if (contentLengthHeader) {
        const contentLength = Number(contentLengthHeader);
        if (!Number.isFinite(contentLength) || contentLength < 0) throw bodyError(400);
        if (contentLength > MAX_GEOCODING_BODY_BYTES) throw bodyError(413);
    }

    const rawBody = await readBoundedRawBody(event);
    if (!rawBody) throw bodyError(400);

    try {
        return JSON.parse(rawBody) as T;
    } catch {
        throw bodyError(400);
    }
}
