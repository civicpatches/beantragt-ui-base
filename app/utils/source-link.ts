/**
 * The "Quelltext" entry: the address of the source code a network service under the AGPL offers its
 * users. Deployment configuration, not code: `NUXT_PUBLIC_SOURCE_URL` may contain `{version}`, filled from
 * `NUXT_PUBLIC_APP_VERSION`. The entry is hidden rather than pointing somewhere wrong.
 */

/** A release tag: `v` and three numbers, nothing else (`v1.2.3`; not `main`, a commit hash or `v1.2.3-rc1`). */
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/u;
const VERSION_PLACEHOLDER = '{version}';

/**
 * The address of the entry, or null when it is hidden: no address configured; an address that is not http or https;
 * or an address with `{version}` while the version is not a release tag.
 */
export function sourceCodeHref(sourceUrl: string | null | undefined, version: string | null | undefined): string | null {
    const address = (sourceUrl ?? '').trim();
    if (!address) return null;
    let href = address;
    if (address.includes(VERSION_PLACEHOLDER)) {
        const tag = (version ?? '').trim();
        if (!RELEASE_TAG.test(tag)) return null;
        href = address.split(VERSION_PLACEHOLDER).join(tag);
    }
    return httpLinkHref(href);
}

/** The short version is for display. The source address uses the full release tag. */
export function productReleaseInfo(sourceUrl: string | null | undefined, appVersion: unknown) {
    const releaseTag = String(appVersion ?? '').trim();
    const href = sourceCodeHref(sourceUrl, releaseTag);
    return {
        version: releaseTag.replace(/^v(?=\d)/u, ''),
        href,
        icon: href && new URL(href).hostname === 'github.com' ? 'i-lucide-github' : 'i-lucide-code'
    };
}

/** Accept an operator's absolute web address and preserve its spelling. */
export function httpLinkHref(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const href = value.trim();
    try {
        // Checked, not rewritten: the address stays exactly as the operator configured it.
        const { protocol } = new URL(href);
        return protocol === 'https:' || protocol === 'http:' ? href : null;
    } catch {
        return null;
    }
}
