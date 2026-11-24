import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSetupCapabilities } from '~~/casework-layer/server/utils/schema-publish-capability';

const request = vi.fn();
const buildHeaders = vi.fn(() => ({ Cookie: 'SESS=staff-fixture', Accept: 'application/json' }));
vi.stubGlobal('drupalSessionRequest', request);
vi.stubGlobal('buildDrupalRequestHeaders', buildHeaders);
vi.stubGlobal('getHeader', vi.fn(() => 'SESS=staff-fixture'));
vi.stubGlobal('createSafeError', (options: { statusCode: number, message: string, data: unknown }) =>
    Object.assign(new Error(options.message), options));

const id = 'fbc3b086-ac53-412e-9bbf-ccb03f286923';
const event = {} as Parameters<typeof fetchSetupCapabilities>[0];

describe('Drupal form publish capability', () => {
    beforeEach(() => {
        request.mockReset();
    });

    it('uses a bounded GET under the person’s session and returns both booleans', async () => {
        request.mockResolvedValue(new Response(JSON.stringify({ canEdit: true, canPublish: false })));

        await expect(fetchSetupCapabilities(event, id)).resolves.toEqual({ canEdit: true, canPublish: false });
        expect(buildHeaders).toHaveBeenCalledWith(event, { accept: 'application/json', cookieHeader: 'SESS=staff-fixture' });
        expect(request).toHaveBeenCalledWith(event, `/api/admin/form-setup/forms/${id}/capabilities`, {
            method: 'GET', headers: { Cookie: 'SESS=staff-fixture', Accept: 'application/json' }, maxResponseBytes: 4 * 1024 * 1024
        });
    });

    it.each([
        '', '{invalid', 'null', '[]', '{"canEdit":true}', '{"canEdit":true,"canPublish":"yes"}',
        '{"data":{"canEdit":true,"canPublish":true}}', '{"canEdit":true,"canPublish":true,"extra":true}'
    ])('rejects a malformed reply (%s)', async (body) => {
        request.mockResolvedValue(new Response(body));
        await expect(fetchSetupCapabilities(event, id)).rejects.toMatchObject({ statusCode: 502, data: { code: 'errors.schemaSetup.loadFailed' } });
    });

    it('preserves the safe Drupal not-found code and strips the upstream detail', async () => {
        request.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'form_setup.form_not_found', detail: 'private' } }), { status: 404 }));
        await expect(fetchSetupCapabilities(event, id)).rejects.toMatchObject({
            statusCode: 404, data: { code: 'errors.schema.notFound', upstreamCode: 'form_setup.form_not_found' }
        });
    });

    it('fails closed when transport fails', async () => {
        request.mockRejectedValue(new Error('connection lost'));
        await expect(fetchSetupCapabilities(event, id)).rejects.toMatchObject({ statusCode: 502, data: { code: 'errors.schemaSetup.loadFailed' } });
    });
});
