import type { H3Event } from 'h3';
import type { OutgoingHttpHeaders, OutgoingHttpHeader } from 'node:http';

/** Nitro handles errors through res.end(), bypassing beforeResponse hooks. */
export function preservePrivateNoStore(event: H3Event): void {
    const response = event.node?.res;
    if (!response?.writeHead || event.context.privateNoStoreInstalled) return;
    event.context.privateNoStoreInstalled = true;
    const original = response.writeHead.bind(response);
    response.writeHead = ((statusCode: number, statusOrHeaders?: string | OutgoingHttpHeaders | OutgoingHttpHeader[], rawHeaders?: OutgoingHttpHeaders | OutgoingHttpHeader[]) => {
        // Last boundary before headers reach the socket, after Nitro's 404 rewrite.
        response.setHeader('Cache-Control', 'private, no-store');
        const incoming = typeof statusOrHeaders === 'string' ? rawHeaders : statusOrHeaders;
        let headers = incoming;
        if (Array.isArray(incoming)) {
            headers = [];
            for (let index = 0; index < incoming.length; index += 2) {
                if (String(incoming[index]).toLowerCase() !== 'cache-control') headers.push(incoming[index]!, incoming[index + 1]!);
            }
        } else if (incoming) {
            headers = Object.fromEntries(Object.entries(incoming).filter(([name]) => name.toLowerCase() !== 'cache-control'));
        }
        return typeof statusOrHeaders === 'string' ? original(statusCode, statusOrHeaders, headers) : original(statusCode, headers);
    }) as typeof original;
}
