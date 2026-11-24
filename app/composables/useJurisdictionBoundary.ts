import type { JurisdictionBoundary } from '~/types/jurisdiction-boundary';
import { ref, shallowRef, toValue, type MaybeRefOrGetter } from 'vue';
import {
    isPointInJurisdictionBoundary,
    normalizeJurisdictionBoundary
} from '~/utils/jurisdiction-boundary';

const boundaryCache = new Map<string, JurisdictionBoundary | null>();
const pendingBoundaryLoads = new Map<string, Promise<JurisdictionBoundary | null>>();

async function fetchBoundary(slug: string): Promise<JurisdictionBoundary | null> {
    try {
        const response = await $fetch<{ boundary?: unknown }>(`/api/jurisdictions/${encodeURIComponent(slug)}/boundary`);
        const boundary = normalizeJurisdictionBoundary(response.boundary);
        if (boundary) return boundary;
    } catch {
        // A jurisdiction-specific, same-origin file is the reference fallback.
    }

    try {
        const response = await $fetch<unknown>(`/data/boundaries/${encodeURIComponent(slug)}.json`);
        return normalizeJurisdictionBoundary(response);
    } catch {
        return null;
    }
}

async function cachedBoundary(slug: string): Promise<JurisdictionBoundary | null> {
    if (boundaryCache.has(slug)) return boundaryCache.get(slug) ?? null;
    const pending = pendingBoundaryLoads.get(slug) ?? fetchBoundary(slug);
    pendingBoundaryLoads.set(slug, pending);
    try {
        const boundary = await pending;
        boundaryCache.set(slug, boundary);
        return boundary;
    } finally {
        pendingBoundaryLoads.delete(slug);
    }
}

export function clearJurisdictionBoundaryCache(): void {
    boundaryCache.clear();
    pendingBoundaryLoads.clear();
}

/**
 * Lazy, jurisdiction-keyed boundary loading with fail-open validation.
 */
export function useJurisdictionBoundary(jurisdictionSlug: MaybeRefOrGetter<string | null | undefined>) {
    const boundary = shallowRef<JurisdictionBoundary | null>(null);
    const loading = ref(false);
    const unavailable = ref(false);
    let loadSequence = 0;

    async function load(): Promise<JurisdictionBoundary | null> {
        const slug = String(toValue(jurisdictionSlug) || '').trim().toLowerCase();
        const sequence = ++loadSequence;
        boundary.value = null;
        unavailable.value = false;
        if (!slug) return null;

        loading.value = true;
        try {
            const next = await cachedBoundary(slug);
            if (sequence !== loadSequence) return boundary.value;
            boundary.value = next;
            unavailable.value = next === null;
            return next;
        } finally {
            if (sequence === loadSequence) loading.value = false;
        }
    }

    function contains(lat: number, lng: number): boolean | null {
        return boundary.value ? isPointInJurisdictionBoundary(boundary.value, lat, lng) : null;
    }

    return { boundary, loading, unavailable, load, contains };
}
