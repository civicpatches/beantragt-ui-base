/**
 * Pure helpers of the decision document UI: placeholder texts to copy
 * into Word, grouping and search of the variable catalog, test ids, base64
 * upload encoding and the file fetch behind every download.
 */
import type { DocgenDocument, DocgenVariable } from '~/types/docgen';
import type { FormField, FormSection } from '~/types/form';
import { useGlobalMaintenance } from '~/composables/useGlobalMaintenance';
import { redirectStaffSessionOnUnauthorized } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import { dispositionFilename } from '~~/casework-layer/app/utils/staff-file';

/** Same rule as VariableCatalog::isUsableId() in Drupal. */
export function isUsableDocgenId(id: string): boolean {
    return id !== '' && id.length <= 128 && !/[{}\s]/u.test(id);
}

/** `data-testid` slug of a template name ("Bewilligung Bewohnerparkausweis" -> "bewilligung-bewohnerparkausweis"). */
export function docgenTemplateSlug(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/gu, '')
        .toLowerCase()
        .replace(/ß/gu, 'ss')
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 80) || 'template';
}

/** The multi-line loop block of a repeatable section, ready to paste. */
export function docgenLoopBlock(loopTag: string, childSyntax: string[]): string {
    return [`{#${loopTag}}`, ...childSyntax, `{/${loopTag}}`].join('\n');
}

/** Text the copy button puts on the clipboard: the placeholder with braces, or the whole loop. */
export function docgenCopyText(variable: Pick<DocgenVariable, 'tag' | 'syntax' | 'repeatable' | 'children'>): string {
    if (variable.repeatable) return docgenLoopBlock(variable.tag, (variable.children ?? []).map(child => child.syntax));
    return variable.syntax;
}

/**
 * Placeholder of one form field as the field inspector shows it. Inside a
 * repeatable section the field only works within its loop, so the copy text
 * is the loop block around it.
 */
export function docgenFieldPlaceholder(section: Pick<FormSection, 'id' | 'repeatable'> | null | undefined, field: Pick<FormField, 'id'> | null | undefined): { display: string, copy: string, loop: string | null } | null {
    if (!section || !field || !isUsableDocgenId(field.id)) return null;
    if (section.repeatable === true) {
        if (!isUsableDocgenId(section.id)) return null;
        const loop = `antrag.${section.id}`;
        return { display: `{${field.id}}`, copy: docgenLoopBlock(loop, [`{${field.id}}`]), loop };
    }
    const syntax = `{antrag.${field.id}}`;
    return { display: syntax, copy: syntax, loop: null };
}

export interface DocgenVariableGroup {
    id: string
    title: string
    system: boolean
    variables: DocgenVariable[]
}

function variableLabel(variable: { label: { de: string, en: string } }, locale: string): string {
    return (locale === 'en' ? variable.label.en : variable.label.de) || variable.label.de || variable.label.en;
}

/** System placeholders first, then one group per form section in schema order; filtered by a search text. */
export function groupDocgenVariables(variables: DocgenVariable[], locale: string, query: string, systemTitle: string): DocgenVariableGroup[] {
    const needle = query.trim().toLowerCase();
    const matches = (variable: DocgenVariable) => !needle
      || variable.tag.toLowerCase().includes(needle)
      || variableLabel(variable, locale).toLowerCase().includes(needle)
      || (variable.children ?? []).some(child => child.tag.toLowerCase().includes(needle) || variableLabel(child, locale).toLowerCase().includes(needle));
    const groups: DocgenVariableGroup[] = [];
    const byId = new Map<string, DocgenVariableGroup>();
    for (const variable of variables) {
        if (!matches(variable)) continue;
        const id = variable.group === 'system' ? '__system' : `section:${variable.section?.id ?? ''}`;
        let group = byId.get(id);
        if (!group) {
            const title = variable.group === 'system'
                ? systemTitle
                : (variable.section ? variableLabel({ label: variable.section.title }, locale) : '') || variable.section?.id || '';
            group = { id, title, system: variable.group === 'system', variables: [] };
            byId.set(id, group);
            groups.push(group);
        }
        group.variables.push(variable);
    }
    return groups;
}

/** "Abschnitt kopieren": every placeholder of a group, one per line (loops as blocks). */
export function docgenSectionCopyText(group: Pick<DocgenVariableGroup, 'variables'>): string {
    return group.variables.map(docgenCopyText).join('\n');
}

export function docgenVariableLabel(variable: { label: { de: string, en: string } }, locale: string): string {
    return variableLabel(variable, locale);
}

export function docgenPlaceholderLabel(tag: string, label: string | undefined, locale: string): string {
    const field = tag.split('.').at(-1) ?? '';
    const display = label?.trim();
    if (display && display !== tag && display !== field) return display;
    const words = field
        .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
    return words.charAt(0).toLocaleUpperCase(locale) + words.slice(1);
}

/** Releasable drafts of a case, the clicked one first. */
export function releasableDocuments(documents: DocgenDocument[], first?: string): DocgenDocument[] {
    const ready = documents.filter(document => document.state === 'draft' && document.canRelease);
    return [...ready.filter(document => document.id === first), ...ready.filter(document => document.id !== first)];
}

/** Base64 of a file, chunked so large files do not overflow the call stack. */
export async function fileToBase64(file: Blob): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

export const DOCGEN_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** The file fetch moved to staff-file.ts; the old name stays for the docgen call sites. */
export { fetchStaffFile as fetchDocgenFile } from '~~/casework-layer/app/utils/staff-file';

/**
 * POSTs a JSON body to a staff proxy route that answers with a file (the
 * Nachreichung cover sheet). Same error, login redirect and maintenance
 * handling as fetchDocgenFile; the browser sends its Origin, which the
 * proxy's same-origin check needs.
 */
export async function postStaffFile(url: string, query: Record<string, string | undefined>, body: Record<string, unknown>, fallback: string): Promise<{ blob: Blob, filename: string }> {
    const search = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    const response = await fetch(search.size ? `${url}?${search.toString()}` : url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/pdf, application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        let data: unknown = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }
        const error = Object.assign(new Error('staff file request failed'), { statusCode: response.status, status: response.status, data });
        if (!await redirectStaffSessionOnUnauthorized(error)) await useGlobalMaintenance().handleRequestError(error);
        throw error;
    }
    return { blob: await response.blob(), filename: dispositionFilename(response.headers.get('content-disposition'), fallback) };
}

/**
 * Hex SHA-256 of the bytes the browser received (Web Crypto).
 *
 * Web Crypto exists only in a secure context (HTTPS, localhost); elsewhere
 * the confirmation fails with docgen.insecure_context, which says why.
 */
export async function sha256Hex(blob: Blob): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw Object.assign(new Error('Web Crypto needs a secure context'), { data: { code: 'docgen.insecure_context' } });
    }
    const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * `details.retryAfter` of a docgen.busy or docgen.rate_limited error, in
 * seconds; also of docgen.locked when Drupal sends one (application lock).
 */
export function docgenRetryAfter(error: unknown): number | null {
    const envelope = (error as { data?: { data?: { code?: unknown, retryAfter?: unknown } } } | null)?.data;
    const data = envelope?.data ?? (envelope as { code?: unknown, retryAfter?: unknown } | undefined);
    const lockedWithWait = data?.code === 'docgen.locked' && data.retryAfter !== undefined;
    if (data?.code !== 'docgen.busy' && data?.code !== 'docgen.rate_limited' && !lockedWithWait) return null;
    const seconds = Number(data.retryAfter);
    return Number.isSafeInteger(seconds) && seconds > 0 ? Math.min(seconds, 300) : 5;
}

/** Error code, reason and veraPDF result of a proxy error. */
export function docgenErrorInfo(error: unknown): { code: string | null, reason: string | null, status: number | null, validation: { failedRules: number, summary: string } | null } {
    const failure = error as { statusCode?: unknown, status?: unknown, data?: { data?: Record<string, unknown> } & Record<string, unknown> } | null;
    const data = (failure?.data?.data ?? failure?.data) as Record<string, unknown> | undefined;
    const status = typeof failure?.statusCode === 'number' ? failure.statusCode : typeof failure?.status === 'number' ? failure.status : null;
    const validation = data?.validation && typeof data.validation === 'object' ? data.validation as Record<string, unknown> : null;
    const failedRules = Number(validation?.failedRules);
    return {
        code: typeof data?.code === 'string' ? data.code : null,
        reason: typeof data?.reason === 'string' ? data.reason : null,
        status,
        validation: validation
            ? { failedRules: Number.isSafeInteger(failedRules) && failedRules > 0 ? failedRules : 0, summary: typeof validation.summary === 'string' ? validation.summary.trim().slice(0, 500) : '' }
            : null
    };
}
