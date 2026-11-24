/**
 * Contract of "Alle meine Daten löschen" under "Meine Daten".
 *
 * Drupal (GET /auth/gdpr/preview, DELETE /auth/gdpr/all) deletes the
 * account, profiles with consents, login links, unconfirmed submissions and
 * uploads that were never submitted with an application.
 * Submitted applications stay with the authority until its retention rule
 * removes them; the preview lists them with reference number, Stelle and the
 * expected deletion date. The Nuxt proxies pass only this documented shape.
 */

export interface ErasureStelleContact {
    email?: string
    phone?: string
    website?: string
}

export interface ErasureKeptApplication {
    id: string
    referenceNumber: string
    formTitle?: string
    submittedAt?: string
    /** Contact address stored on the application; it stays there. */
    applicantEmail?: string
    stelle: {
        organisation?: string
        jurisdiction?: string
        contact: ErasureStelleContact
    }
    retention: {
        /** Retention window in days counted from submission; 0 = no rule. */
        days: number
        /** schema, jurisdiction, global, global_invalid, global_unscoped, unmatched */
        source: string
        /** ISO date from which the cleanup run removes the application. */
        deleteAfter?: string
    }
}

export interface ErasurePreview {
    deletes: {
        account: boolean
        accountEmail?: string
        profiles: Array<{ scopeLabel?: string }>
        unconfirmedApplications: number
        unconfirmedUploads: number
        loginLinks: number
    }
    keeps: ErasureKeptApplication[]
}

export interface ErasureSummary {
    erasedAt?: string
    deleted: {
        account: boolean
        profiles: number
        unconfirmedApplications: number
        unconfirmedUploads: number
        loginLinks: number
    }
    keeps: ErasureKeptApplication[]
}

/**
 * How the page words the retention of one kept application: a date when a
 * cleanup run removes it, otherwise no automatic deletion.
 */
export type ErasureRetentionKind = 'date' | 'none';

/** A retention window in the largest unit a citizen reads easily. */
export interface ErasureRetentionDuration {
    unit: 'days' | 'months' | 'years'
    count: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown, maxLength = 255): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function count(value: unknown): number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

function isoDate(value: unknown): string | undefined {
    const candidate = text(value, 40);
    return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : undefined;
}

function website(value: unknown): string | undefined {
    const candidate = text(value, 500);
    if (!candidate) return undefined;
    try {
        const url = new URL(candidate);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
    } catch {
        return undefined;
    }
}

function email(value: unknown): string | undefined {
    const candidate = text(value, 254);
    return candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate) ? candidate : undefined;
}

function keptApplication(value: unknown): ErasureKeptApplication | null {
    if (!isRecord(value)) return null;
    const id = text(value.id, 64);
    const referenceNumber = text(value.referenceNumber, 128);
    if (!id || !referenceNumber) return null;
    const stelle = isRecord(value.stelle) ? value.stelle : {};
    const contact = isRecord(stelle.contact) ? stelle.contact : {};
    const retention = isRecord(value.retention) ? value.retention : {};
    const days = typeof retention.days === 'number' && Number.isInteger(retention.days) && retention.days > 0
        ? retention.days
        : 0;
    return {
        id,
        referenceNumber,
        formTitle: text(value.formTitle),
        submittedAt: isoDate(value.submittedAt),
        applicantEmail: email(value.applicantEmail),
        stelle: {
            organisation: text(stelle.organisation),
            jurisdiction: text(stelle.jurisdiction),
            contact: {
                email: email(contact.email),
                phone: text(contact.phone, 64),
                website: website(contact.website)
            }
        },
        retention: {
            days,
            source: text(retention.source, 32) || 'global',
            deleteAfter: days > 0 ? isoDate(retention.deleteAfter) : undefined
        }
    };
}

function keptApplications(value: unknown): ErasureKeptApplication[] {
    return Array.isArray(value)
        ? value.map(keptApplication).filter((entry): entry is ErasureKeptApplication => entry !== null)
        : [];
}

/**
 * Keeps only the documented preview shape from the Drupal response.
 */
export function normalizeErasurePreview(raw: unknown): ErasurePreview {
    const data = isRecord(raw) ? raw : {};
    const deletes = isRecord(data.deletes) ? data.deletes : {};
    return {
        deletes: {
            account: deletes.account === true,
            accountEmail: email(deletes.accountEmail),
            profiles: Array.isArray(deletes.profiles)
                ? deletes.profiles.map(profile => ({ scopeLabel: isRecord(profile) ? text(profile.scopeLabel) : undefined }))
                : [],
            unconfirmedApplications: count(deletes.unconfirmedApplications),
            unconfirmedUploads: count(deletes.unconfirmedUploads),
            loginLinks: count(deletes.loginLinks)
        },
        keeps: keptApplications(data.keeps)
    };
}

/**
 * Keeps only the documented summary shape from the Drupal response.
 */
export function normalizeErasureSummary(raw: unknown): ErasureSummary {
    const data = isRecord(raw) ? raw : {};
    const deleted = isRecord(data.deleted) ? data.deleted : {};
    return {
        erasedAt: isoDate(data.erasedAt),
        deleted: {
            account: deleted.account === true,
            profiles: count(deleted.profiles),
            unconfirmedApplications: count(deleted.unconfirmedApplications),
            unconfirmedUploads: count(deleted.unconfirmedUploads),
            loginLinks: count(deleted.loginLinks)
        },
        keeps: keptApplications(data.keeps)
    };
}

/**
 * Names the Stelle of a kept application: organisation, then jurisdiction.
 */
export function erasureStelleLabel(application: ErasureKeptApplication): string {
    const labels = [application.stelle.organisation, application.stelle.jurisdiction]
        .filter((label): label is string => Boolean(label));
    return [...new Set(labels)].join(', ');
}

/**
 * A date when a cleanup run deletes the application, otherwise "none": the
 * application stays until the Stelle deletes it, whatever the reason.
 */
export function erasureRetentionKind(application: ErasureKeptApplication): ErasureRetentionKind {
    return application.retention.days > 0 && application.retention.deleteAfter ? 'date' : 'none';
}

/**
 * Converts a retention window in days into years, months or days.
 *
 * Whole years when the window is at least about a year (3650 days are 10
 * years), whole months from 60 days on, days below that.
 */
export function erasureRetentionDuration(days: number): ErasureRetentionDuration {
    const value = Number.isFinite(days) && days > 0 ? Math.round(days) : 0;
    if (value >= 365) {
        return { unit: 'years', count: Math.max(1, Math.round(value / 365.25)) };
    }
    if (value >= 60) {
        return { unit: 'months', count: Math.round(value / 30.44) };
    }
    return { unit: 'days', count: value };
}

/**
 * The contact address all kept applications share, or undefined when they
 * differ or none is known.
 */
export function erasureSharedContactEmail(keeps: ErasureKeptApplication[]): string | undefined {
    const emails = new Set(keeps.map(application => application.applicantEmail?.toLowerCase()));
    if (emails.size !== 1) return undefined;
    const [only] = [...emails];
    return only || undefined;
}

/**
 * Maps a refused Drupal erasure call to the error the citizen sees.
 *
 * Drupal answers 403 for non-citizen accounts (code
 * gdpr.not_citizen_account), but also when the Drupal session has expired
 * while the browser still holds the cookie, or when the CSRF check fails.
 * Only the first case means "this function is not for you"; the others ask
 * the citizen to log in again.
 */
export function erasureRefusal(status: number, body: unknown, fallbackCode: string): { statusCode: number, code: string } {
    if (status === 403 && isRecord(body) && body.code === 'gdpr.not_citizen_account') {
        return { statusCode: 403, code: 'errors.citizen.deleteNotAllowed' };
    }
    if (status === 401 || status === 403) {
        return { statusCode: 401, code: 'errors.auth.notAuthenticated' };
    }
    return { statusCode: 502, code: fallbackCode };
}
