import type { H3Event } from 'h3';

/**
 * Reads a request body with a hard byte bound, including chunked requests
 * without Content-Length. `tooLarge` must throw the caller's 413 error; it is
 * delivered first, then the rest of the connection is discarded.
 */
export function readBoundedBody(event: H3Event, maxBytes: number, tooLarge: () => never): Promise<string | undefined> {
    const request = event.node.req;
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const cleanup = () => {
            request.off('data', onData);
            request.off('end', onEnd);
            request.off('error', onError);
            request.off('aborted', onAborted);
        };
        const onError = (error: Error) => {
            cleanup();
            reject(error);
        };
        const onAborted = () => onError(new Error('Request aborted'));
        const onEnd = () => {
            cleanup();
            resolve(size ? Buffer.concat(chunks, size).toString('utf8') : undefined);
        };
        const onData = (chunk: Buffer | string) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > maxBytes) {
                cleanup();
                request.pause();
                event.node.res.setHeader('Connection', 'close');
                event.node.res.once('finish', () => request.destroy());
                try {
                    tooLarge();
                } catch (error) {
                    reject(error);
                }
                return;
            }
            chunks.push(bytes);
        };
        request.on('data', onData);
        request.once('end', onEnd);
        request.once('error', onError);
        request.once('aborted', onAborted);
    });
}
