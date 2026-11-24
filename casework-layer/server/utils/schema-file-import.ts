import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import type { H3Event } from 'h3';
import { validateImportedFormSchema } from '~~/app/utils/form-schema';
import { MAX_SCHEMA_IMPORT_BYTES } from '#shared/schema-file-import';
import { formCreateError } from './form-create';

function malformed() {
    return formCreateError(400, 'errors.schema.importMalformed');
}

function tooLarge() {
    return formCreateError(413, 'errors.schema.importTooLarge');
}

// Same bounded listener pattern as server/utils/geocoding-request.ts. Keep
// counting bytes for chunked requests and drain after exceeding the limit.
function readImportBytes(event: H3Event): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const webBody = event.web?.request?.body;
        if (event.web?.request && !webBody) {
            reject(malformed());
            return;
        }
        const request = webBody ? Readable.fromWeb(webBody as ReadableStream<Uint8Array>) : event.node.req;
        if (request.destroyed || request.readableEnded) {
            reject(malformed());
            return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;

        request.on('data', (chunk: Buffer) => {
            if (settled) return;
            size += chunk.length;
            if (size > MAX_SCHEMA_IMPORT_BYTES) {
                settled = true;
                chunks.length = 0;
                request.resume();
                reject(tooLarge());
                return;
            }
            chunks.push(chunk);
        });
        request.once('end', () => {
            if (settled) return;
            settled = true;
            resolve(Buffer.concat(chunks, size));
        });
        const fail = () => {
            if (settled) return;
            settled = true;
            reject(malformed());
        };
        request.once('aborted', fail);
        request.once('error', fail);
        request.once('close', fail);
    });
}

export async function readSchemaRequestJson(event: H3Event): Promise<unknown> {
    const contentType = getHeader(event, 'content-type') ?? '';
    const encoding = getHeader(event, 'content-encoding');
    if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/iu.test(contentType.trim())
      || (encoding && encoding.trim().toLowerCase() !== 'identity')) {
        throw formCreateError(415, 'errors.schema.importMedia');
    }

    const contentLength = getHeader(event, 'content-length');
    if (contentLength !== undefined) {
        if (!/^\d+$/u.test(contentLength)) throw malformed();
        if (Number(contentLength) > MAX_SCHEMA_IMPORT_BYTES) throw tooLarge();
    }

    const bytes = await readImportBytes(event);
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        throw malformed();
    }
}

export async function readSchemaFileImport(event: H3Event) {
    const definition = await readSchemaRequestJson(event);
    const schema = validateImportedFormSchema(definition);
    if (!schema) throw formCreateError(422, 'errors.schema.importShape');

    return {
        title: schema.title,
        description: schema.description ?? '',
        // Keep the original definition, including valid classifications and metadata.
        definition: JSON.stringify(definition)
    };
}
