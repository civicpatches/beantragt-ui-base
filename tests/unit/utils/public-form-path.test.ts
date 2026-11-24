import { describe, expect, it } from 'vitest';
import {
    publicApplicationPath,
    publicApplicationsPath,
    publicFormPath,
    publicFormStatusPath,
    publicHomePath,
    publicLoginPath,
    safeExternalAuthReturnPath,
    safeLocalAuthReturnPath,
    publicStartPath,
    publicStatusLookupPath,
    publicWorkspaceFromKey,
    publicWorkspaceFromRoute
} from '~/utils/public-form-path';

describe('public form path helpers', () => {
    it('keeps public paths global when no workspace slug exists', () => {
        expect(publicStartPath()).toBe('/start');
        expect(publicHomePath()).toBe('/');
        expect(publicLoginPath()).toBe('/auth/login');
        expect(publicApplicationsPath()).toBe('/meine-antraege');
        expect(publicStatusLookupPath()).toBe('/status');
        expect(publicFormPath({ id: 'schema-1' })).toBe('/form/schema-1');
        expect(publicFormPath({})).toBe('/start');
    });

    it('keeps ordinary same-origin login return paths', () => {
        const path = '/musterstadt/form/schema-1?step=2#attachment';

        expect(safeLocalAuthReturnPath(path, '/musterstadt/start')).toBe(path);
        expect(safeExternalAuthReturnPath(path, '/musterstadt/start')).toBe(path);
    });

    it('rejects malformed or cross-origin login return paths', () => {
        expect(safeLocalAuthReturnPath('https://evil.example', '/musterstadt/start'))
            .toBe('/musterstadt/start');
        expect(safeLocalAuthReturnPath('//evil.example', '/musterstadt/start'))
            .toBe('/musterstadt/start');
        expect(safeLocalAuthReturnPath('/\\evil.example', '/musterstadt/start'))
            .toBe('/musterstadt/start');
    });

    it('checks the normalised value too: dot segments never yield a protocol-relative URL', () => {
        const fallback = '/musterstadt/meine-antraege';
        for (const hostile of [
            '/..//evil.example',
            '/.//evil.example',
            '/%2e%2e//evil.example',
            '/a/..//evil.example',
            '/..//evil.example/admin',
            '/musterstadt/../..//evil.example/x?y=1#z'
        ]) {
            expect(safeLocalAuthReturnPath(hostile, fallback), hostile).toBe(fallback);
            expect(safeExternalAuthReturnPath(hostile, fallback), hostile).toBe(fallback);
        }
    });

    it('still keeps real local paths, also with double slashes inside or encoded slashes', () => {
        const fallback = '/x';
        expect(safeLocalAuthReturnPath('/musterstadt/../musterstadt/start', fallback)).toBe('/musterstadt/start');
        expect(safeLocalAuthReturnPath('/a//b', fallback)).toBe('/a//b');
        expect(safeLocalAuthReturnPath('/%2F%2Fhost', fallback)).toBe('/%2F%2Fhost');
        expect(safeLocalAuthReturnPath('/musterstadt/admin/forms/7', fallback)).toBe('/musterstadt/admin/forms/7');
        expect(safeLocalAuthReturnPath('/start?lang=en#top', fallback)).toBe('/start?lang=en#top');
    });

    it('keeps bearer capabilities out of external identity-provider redirects', () => {
        const fallback = '/musterstadt/meine-antraege';

        expect(safeExternalAuthReturnPath(
            '/musterstadt/form/schema-1/status/public-status-token',
            fallback
        )).toBe(fallback);
        expect(safeExternalAuthReturnPath('/musterstadt/confirm/confirmation-token', fallback))
            .toBe(fallback);
        expect(safeExternalAuthReturnPath('/workspace/invite?token=invite-token', fallback))
            .toBe(fallback);

        expect(safeLocalAuthReturnPath('/workspace/invite?token=invite-token', fallback))
            .toBe('/workspace/invite?token=invite-token');
    });

    it('prefixes citizen and form paths with jurisdiction and organisation slugs', () => {
        const workspace = {
            jurisdictionSlug: 'stadt-musterstadt',
            organisationSlug: 'citizen-services'
        };

        expect(publicStartPath(workspace)).toBe('/stadt-musterstadt/citizen-services/start');
        expect(publicHomePath(workspace)).toBe('/stadt-musterstadt/citizen-services/start');
        expect(publicLoginPath(workspace)).toBe('/stadt-musterstadt/citizen-services/auth/login');
        expect(publicApplicationsPath(workspace)).toBe('/stadt-musterstadt/citizen-services/meine-antraege');
        expect(publicStatusLookupPath({ ...workspace, referenceNumber: 'MS-BB-2026-00001' }))
            .toBe('/stadt-musterstadt/citizen-services/status?ref=MS-BB-2026-00001');
        expect(publicApplicationPath({ ...workspace, applicationId: 'app-1' }))
            .toBe('/stadt-musterstadt/citizen-services/meine-antraege/app-1');
        expect(publicFormPath({ ...workspace, id: 'schema-1' }))
            .toBe('/stadt-musterstadt/citizen-services/form/schema-1');
        expect(publicFormStatusPath({ ...workspace, id: 'schema-1', statusToken: 'token-1' }))
            .toBe('/stadt-musterstadt/citizen-services/form/schema-1/status/token-1');
        expect(publicFormPath(workspace)).toBe('/stadt-musterstadt/citizen-services/start');
    });

    it('extracts public workspace slugs from route params', () => {
        expect(publicWorkspaceFromRoute({
            params: {
                workspace: 'stadt-musterstadt',
                organisation: 'citizen-services'
            }
        })).toEqual({
            jurisdictionSlug: 'stadt-musterstadt',
            organisationSlug: 'citizen-services'
        });
    });

    it('extracts public workspace slugs from a persisted admin workspace key', () => {
        expect(publicWorkspaceFromKey('/stadt-musterstadt/citizen-services/')).toEqual({
            jurisdictionSlug: 'stadt-musterstadt',
            organisationSlug: 'citizen-services'
        });
        expect(publicWorkspaceFromKey(null)).toEqual({
            jurisdictionSlug: null,
            organisationSlug: null
        });
    });
});
