import type { JsonObject } from './public-schema-values';

export interface PublicSchemaExtensionContext {
    parsed: JsonObject
    projected: JsonObject
    formId: string
    scope: { jurisdictionSlug: string | null, organisationSlug: string | null }
    clientIp: string
}

type PublicSchemaExtension = (context: PublicSchemaExtensionContext) => Promise<JsonObject>;

let extension: PublicSchemaExtension | undefined;

export function registerPublicSchemaExtension(callback: PublicSchemaExtension): void {
    extension = callback;
}

export async function applyPublicSchemaExtension(context: PublicSchemaExtensionContext): Promise<JsonObject> {
    return extension ? extension(context) : {};
}
