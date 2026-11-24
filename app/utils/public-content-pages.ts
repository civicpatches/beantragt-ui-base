import {
    localizedPath,
    type SupportedLocale
} from './locale-routing';
import {
    publicWorkspacePath,
    type PublicFormPathInput
} from './public-form-path';

export interface PublicContentPageListItem {
    id: string
    attributes?: {
        key?: string
        title?: string
        path?: string
        footerVisible?: boolean
        order?: number
    }
}

export interface PublicContentPageListResponse {
    data?: PublicContentPageListItem[]
}

export interface PublicContentFooterLink {
    id: string
    key: string | null
    title: string
    path: string
    order: number
}

const PUBLIC_CONTENT_PATH_PATTERN = /^\/pages\/[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u;

function safeApiPath(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const path = value.trim().toLowerCase();
    return PUBLIC_CONTENT_PATH_PATTERN.test(path) ? path : null;
}

export function publicContentPagePathFromListItem(
    item: PublicContentPageListItem,
    locale: SupportedLocale,
    workspace: PublicFormPathInput
): string {
    const apiPath = safeApiPath(item.attributes?.path);
    if (apiPath) {
        return localizedPath(`${publicWorkspacePath(workspace)}${apiPath}`, locale);
    }

    return localizedPath(publicWorkspacePath(workspace) || '/', locale);
}

export function publicContentFooterLinks(
    response: PublicContentPageListResponse | null | undefined,
    locale: SupportedLocale,
    workspace: PublicFormPathInput
): PublicContentFooterLink[] {
    const rows = Array.isArray(response?.data) ? response.data : [];

    return rows
        .flatMap((item): PublicContentFooterLink[] => {
            const key = item.attributes?.key;
            if (item.attributes?.footerVisible === false) return [];

            const title = typeof item.attributes?.title === 'string'
                ? item.attributes.title.trim()
                : '';
            if (!title) return [];

            const path = publicContentPagePathFromListItem(item, locale, workspace);
            if (path === localizedPath(publicWorkspacePath(workspace) || '/', locale)) return [];

            const order = Number.isFinite(item.attributes?.order)
                ? Number(item.attributes?.order)
                : 999;

            return [{
                id: item.id,
                key: typeof key === 'string' && key.trim() !== '' ? key : null,
                title,
                order,
                path
            }];
        })
        .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}
