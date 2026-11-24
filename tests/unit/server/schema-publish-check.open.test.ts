import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assessSchemaPublishable, listSchemaPublishIssues } from '~~/casework-layer/server/utils/schema-publish-check';

const drupalSessionFetch = vi.hoisted(() => vi.fn());
const fetchSetupCapabilities = vi.hoisted(() => vi.fn());

vi.mock('~~/casework-layer/server/utils/schema-publish-capability', () => ({ fetchSetupCapabilities }));

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('requireAdmin', vi.fn());
vi.stubGlobal('requireSameOriginRequest', vi.fn());
vi.stubGlobal('setPrivateNoStore', vi.fn());
vi.stubGlobal('readBody', vi.fn(async () => ({ status: 'published' })));
vi.stubGlobal('getRouterParam', vi.fn(() => 'fbc3b086-ac53-412e-9bbf-ccb03f286923'));
vi.stubGlobal('validateUuid', vi.fn());
vi.stubGlobal('applyAdminJurisdictionFilter', vi.fn());
vi.stubGlobal('drupalSessionFetch', drupalSessionFetch);
vi.stubGlobal('createSafeError', (opts: { statusCode: number, message: string, data?: unknown }) => {
    const error = new Error(opts.message) as Error & { statusCode: number, data?: unknown };
    error.statusCode = opts.statusCode;
    if (opts.data !== undefined) error.data = opts.data;
    return error;
});

function schema(fields: unknown[]): string {
    return JSON.stringify({ title: 'Paritaet', sections: [{ id: 'basis', title: 'Basis', fields }] });
}

const CASES: Array<{ name: string, text: string, code: string | null }> = [
    { name: 'valid', text: schema([{ id: 'diagnose', type: 'textarea', label: 'Diagnose', sensitive: true, privacy: { kind: 'special_category' } }]), code: null },
    { name: 'no class needed', text: schema([{ id: 'anzahl', type: 'number', label: 'Anzahl der Hunde' }]), code: null },
    { name: 'explicit e-mail class', text: schema([{ id: 'email', type: 'email', label: 'E-Mail-Adresse', privacy: { kind: 'contact' } }]), code: null },
    { name: 'missing e-mail class', text: schema([{ id: 'email', type: 'email', label: 'E-Mail-Adresse' }]), code: 'errors.schema.authoringRiskUnresolved' },
    { name: 'non-personal e-mail class', text: schema([{ id: 'email', type: 'email', label: 'E-Mail-Adresse', privacy: { kind: 'not_personal' } }]), code: 'errors.schema.authoringRiskUnresolved' },
    { name: 'invalid class on other field', text: schema([{ id: 'anzahl', type: 'number', label: 'Anzahl der Hunde', privacy: { kind: 'unsupported' } }]), code: 'errors.schema.authoringRiskUnresolved' },
    { name: 'high-risk class without protection flag', text: schema([{ id: 'angaben', type: 'text', label: 'Weitere Angaben', privacy: { kind: 'special_category' } }]), code: 'errors.schema.authoringRiskUnresolved' },
    { name: 'invalid json', text: '{not json', code: 'errors.schema.formInvalid' },
    { name: 'invalid shape', text: JSON.stringify({ title: 'x' }), code: 'errors.schema.formInvalid' },
    { name: 'empty', text: '', code: 'errors.schema.formInvalid' },
    { name: 'blocking issue', text: schema([{ id: 'ausweisnummer', type: 'text', label: 'Ausweisnummer' }]), code: 'errors.schema.authoringRiskUnresolved' },
    { name: 'invalid classification', text: schema([{ id: 'ausweisnummer', type: 'text', label: 'Ausweisnummer', privacy: { kind: 'unsupported' } }]), code: 'errors.schema.authoringRiskUnresolved' },
    {
        name: 'duplicate CRM key',
        text: schema([
            { id: 'rep', type: 'text', label: 'Familienname Vertretung', crm_key: 'person.last_name', privacy: { kind: 'identity' } },
            { id: 'own', type: 'text', label: 'Familienname', crm_key: 'person.last_name', privacy: { kind: 'identity' } }
        ]),
        code: 'errors.schema.duplicateCrmKeys'
    }
];

async function runPublishRoute(text: string): Promise<string | null> {
    vi.resetModules();
    drupalSessionFetch.mockReset();
    drupalSessionFetch
        .mockResolvedValueOnce({ data: [{ attributes: { field_schema: text, drupal_internal__revision_id: 7 } }] })
        .mockResolvedValueOnce({ data: {} });
    const handler = (await import('~~/casework-layer/server/api/admin/schemas/[id]/status.patch')).default as (event: unknown) => Promise<unknown>;
    try {
        await handler({});
        return null;
    } catch (error: unknown) {
        return String((error as { data?: { code?: unknown } }).data?.code);
    }
}

describe('assessSchemaPublishable parity with the publish route', () => {
    beforeEach(() => {
        fetchSetupCapabilities.mockReset();
        fetchSetupCapabilities.mockResolvedValue({ canEdit: true, canPublish: true });
    });

    for (const testCase of CASES) {
        it(`agrees with the publish pre-gate: ${testCase.name}`, async () => {
            const issues = listSchemaPublishIssues(assessSchemaPublishable(testCase.text));
            const routeCode = await runPublishRoute(testCase.text);
            expect(routeCode).toBe(testCase.code);
            expect(issues.length === 0).toBe(routeCode === null);
        });
    }

    it('lists a form-level issue without a field for a schema that does not parse', () => {
        expect(listSchemaPublishIssues(assessSchemaPublishable('{not json'))).toEqual([
            { code: 'schema_invalid', sectionId: null, sectionTitle: null, fieldId: null, fieldLabel: null }
        ]);
    });
});
