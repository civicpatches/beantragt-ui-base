/** Collapses ., .. and empty segments and lowercases, without decoding. */
export function canonicalizeSegments(pathname: string): string {
    const segments: string[] = [];
    for (const segment of pathname.split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') {
            segments.pop();
            continue;
        }
        segments.push(segment.toLowerCase());
    }

    return `/${segments.join('/')}`;
}

/** Decodes until stable so nested encoding cannot hide the routed path. */
export function fullyDecoded(pathname: string): string {
    let current = pathname;
    for (let i = 0; i < 5 && current.includes('%'); i++) {
        let next: string;
        try {
            next = decodeURIComponent(current);
        } catch {
            return current;
        }
        if (next === current) break;
        current = next;
    }
    return current;
}

export function canonicalUiPath(path: string): string {
    return canonicalizeSegments(fullyDecoded(path).replaceAll('\\', '/'));
}

export function uiPageDocument(path: string): string {
    return path.replace(/\/(?:_payload\.(?:json|js)|index\.html)$/iu, '').replace(/\.html$/iu, '') || '/';
}
