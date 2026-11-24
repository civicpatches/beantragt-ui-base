<script setup lang="ts">
import type {
    ErrorEvent as MapLibreErrorEvent,
    Map as MapLibreMap,
    Marker as MapLibreMarker,
    MapMouseEvent
} from 'maplibre-gl';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { FormAddressValue } from '~/types/form';
import type { JurisdictionBoundary } from '~/types/jurisdiction-boundary';
import { getAddressMapStyleCandidates } from '~/utils/address-map-styles';
import { createLocationMarkerElement } from '~/utils/create-location-marker';
import {
    addressValueFromGeocodingResult,
    normalizeFormAddressValue
} from '~/utils/form-address';
import { jurisdictionBoundaryBounds } from '~/utils/jurisdiction-boundary';

const props = withDefaults(defineProps<{
    id?: string
    modelValue: FormAddressValue | null
    boundary?: JurisdictionBoundary | null
    disabled?: boolean
}>(), { id: undefined, boundary: null, disabled: false });

const emit = defineEmits<{ 'update:modelValue': [value: FormAddressValue] }>();
const { t } = useI18n();
const { reverseGeocode } = useGeocoding();
const config = useRuntimeConfig();
const colorMode = useColorMode();
const mapContainer = ref<HTMLElement | null>(null);
const loading = ref(true);
const styleChanging = ref(false);
const unavailable = ref(false);
const reverseFailed = ref(false);
const reversePending = ref(false);
const mapReady = ref(false);
let map: MapLibreMap | null = null;
let marker: MapLibreMarker | null = null;
let MarkerConstructor: typeof import('maplibre-gl')['Marker'] | null = null;
let reverseSequence = 0;
let pendingSelection: { lat: number, lng: number } | null = null;
let pendingFallback: FormAddressValue | null = null;
let styleChangeQueued = false;
let styleChangeProcessing = false;
let destroyed = false;
let cancelActiveStyleLoad: (() => void) | null = null;

const styleCandidates = computed(() => getAddressMapStyleCandidates({
    legacy: config.public.addressMapStyleUrl,
    light: config.public.addressMapStyleUrlLight,
    dark: config.public.addressMapStyleUrlDark,
    fallbackLight: config.public.addressMapFallbackStyleUrlLight,
    fallbackDark: config.public.addressMapFallbackStyleUrlDark
}, colorMode.value === 'dark', {
    baseOrigin: window.location.origin,
    allowInsecureLocalhost: import.meta.dev
}));

const allowedMapOrigins = computed(() => {
    const origins = new Set<string>([window.location.origin]);
    for (const candidate of styleCandidates.value) {
        try {
            origins.add(new URL(candidate.url, window.location.origin).origin);
        } catch {
            // Invalid candidates were already removed by the style resolver.
        }
    }
    const configuredOrigins = String(config.public.addressMapAllowedOrigins || '').split(',');
    for (const value of configuredOrigins) {
        try {
            const parsed = new URL(value.trim());
            const localHost = parsed.hostname === 'localhost'
              || parsed.hostname === '127.0.0.1'
              || parsed.hostname === '[::1]';
            if (parsed.protocol === 'https:' || (import.meta.dev && parsed.protocol === 'http:' && localHost)) {
                origins.add(parsed.origin);
            }
        } catch {
            // Operator input is fail-closed.
        }
    }
    return origins;
});

function transformMapRequest(url: string) {
    const parsed = new URL(url, window.location.origin);
    if (!allowedMapOrigins.value.has(parsed.origin)) {
        throw new Error('Blocked unapproved map resource origin');
    }
    return { url: parsed.href, credentials: 'same-origin' as const };
}

function markerColor(): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--ui-primary').trim();
    return /^#[0-9a-f]{6}$/i.test(value) ? value : '#ef4444';
}

function createMarker(MarkerConstructor: typeof import('maplibre-gl')['Marker'], draggable: boolean): MapLibreMarker {
    const element = createLocationMarkerElement(markerColor());
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', t('form.address.markerLabel'));
    return new MarkerConstructor({
        element,
        draggable,
        anchor: 'bottom'
    });
}

function loadMapStyle(styleUrl: string, timeoutMs = 10_000): Promise<boolean> {
    if (!map) return Promise.resolve(false);
    const mapInstance = map;
    return new Promise((resolve) => {
        let settled = false;
        const finish = (loaded: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            mapInstance.off('style.load', onStyleLoad);
            mapInstance.off('error', onStyleError);
            if (cancelActiveStyleLoad === cancel) cancelActiveStyleLoad = null;
            resolve(loaded);
        };
        const cancel = () => finish(false);
        const onStyleLoad = () => finish(true);
        const onStyleError = (event: MapLibreErrorEvent) => {
            const message = event?.error?.message
              || (event as MapLibreErrorEvent & { message?: string }).message
              || '';
            if (
                message.includes('unknown feature value')
                || message.includes('Unimplemented type')
                || message.includes('Could not parse tile')
            ) return;
            finish(false);
        };
        const timeout = setTimeout(() => finish(false), timeoutMs);
        cancelActiveStyleLoad = cancel;
        mapInstance.on('style.load', onStyleLoad);
        mapInstance.on('error', onStyleError);
        try {
            mapInstance.setStyle(styleUrl);
        } catch {
            finish(false);
        }
    });
}

async function loadThemedStyle(): Promise<boolean> {
    for (const candidate of styleCandidates.value) {
        if (await loadMapStyle(candidate.url)) return true;
    }
    return false;
}

async function processStyleChanges(): Promise<void> {
    if (styleChangeProcessing || !map || !mapReady.value) return;
    styleChangeProcessing = true;
    styleChanging.value = true;
    marker?.setDraggable(false);
    try {
        while (styleChangeQueued && map && mapReady.value && !destroyed) {
            styleChangeQueued = false;
            const loaded = await loadThemedStyle();
            if (!loaded) {
                unavailable.value = true;
                continue;
            }
            if (destroyed) return;
            unavailable.value = false;
            addBoundary();
        }
    } finally {
        styleChanging.value = false;
        marker?.setDraggable(!props.disabled && !unavailable.value);
        styleChangeProcessing = false;
        if (styleChangeQueued) void processStyleChanges();
    }
}

function queueStyleChange(): void {
    styleChangeQueued = true;
    void processStyleChanges();
}

function fallbackValue(lat: number, lng: number): FormAddressValue {
    const current = normalizeFormAddressValue(props.modelValue);
    return {
        ...(current ?? { formatted: `${lat.toFixed(6)}, ${lng.toFixed(6)}` }),
        lat,
        lng
    };
}

async function selectCoordinates(lat: number, lng: number): Promise<void> {
    const sequence = ++reverseSequence;
    pendingSelection = { lat, lng };
    const fallback = fallbackValue(lat, lng);
    pendingFallback = fallback;
    emit('update:modelValue', fallback);
    reversePending.value = true;
    reverseFailed.value = false;
    try {
        const result = await reverseGeocode(lat, lng);
        if (sequence !== reverseSequence) return;
        const reverseValue = addressValueFromGeocodingResult(result);
        emit('update:modelValue', reverseValue ? { ...reverseValue, lat, lng } : fallback);
    } catch {
        if (sequence !== reverseSequence) return;
        reverseFailed.value = true;
    } finally {
        if (sequence === reverseSequence) {
            reversePending.value = false;
            pendingSelection = null;
            pendingFallback = null;
        }
    }
}

function bindMarkerDrag(): void {
    marker?.on('dragend', () => {
        if (props.disabled || styleChanging.value || unavailable.value) return;
        const position = marker?.getLngLat();
        if (position) void selectCoordinates(position.lat, position.lng);
    });
}

function syncMarkerWithValue(): void {
    if (!map || !MarkerConstructor) return;
    const current = normalizeFormAddressValue(props.modelValue);
    const hasCoordinates = current?.lat !== undefined && current.lng !== undefined;
    if (!hasCoordinates) {
        marker?.remove();
        marker = null;
        return;
    }
    if (!marker) {
        marker = createMarker(MarkerConstructor, !props.disabled)
            .setLngLat([current.lng!, current.lat!])
            .addTo(map);
        bindMarkerDrag();
        return;
    }
    marker.setLngLat([current.lng!, current.lat!]);
}

function placeMarker(lat: number, lng: number): void {
    if (!map || !MarkerConstructor || props.disabled || styleChanging.value || unavailable.value) return;
    if (!marker) {
        marker = createMarker(MarkerConstructor, true)
            .setLngLat([lng, lat])
            .addTo(map);
        bindMarkerDrag();
    } else {
        marker.setLngLat([lng, lat]);
    }
    void selectCoordinates(lat, lng);
}

function selectMapCenter(): void {
    if (!map || props.disabled || !mapReady.value) return;
    const center = map.getCenter();
    placeMarker(center.lat, center.lng);
}

function removeBoundary(): void {
    if (!map) return;
    if (map.getLayer('jurisdiction-boundary-fill')) map.removeLayer('jurisdiction-boundary-fill');
    if (map.getLayer('jurisdiction-boundary-line')) map.removeLayer('jurisdiction-boundary-line');
    if (map.getSource('jurisdiction-boundary')) map.removeSource('jurisdiction-boundary');
}

function addBoundary(): void {
    if (!map || !props.boundary || map.getSource('jurisdiction-boundary')) return;
    map.addSource('jurisdiction-boundary', {
        type: 'geojson',
        data: props.boundary
    });
    map.addLayer({
        id: 'jurisdiction-boundary-fill',
        type: 'fill',
        source: 'jurisdiction-boundary',
        paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.08 }
    });
    map.addLayer({
        id: 'jurisdiction-boundary-line',
        type: 'line',
        source: 'jurisdiction-boundary',
        paint: { 'line-color': '#2563eb', 'line-width': 2, 'line-dasharray': [2, 2] }
    });
}

watch(() => props.boundary, (next) => {
    if (!map || !map.isStyleLoaded()) return;
    if (!next) {
        removeBoundary();
        return;
    }
    const source = map.getSource('jurisdiction-boundary') as { setData?: (data: JurisdictionBoundary) => void } | undefined;
    if (source?.setData) {
        source.setData(next);
        return;
    }
    addBoundary();
    if (!marker) {
        const bounds = jurisdictionBoundaryBounds(next);
        if (bounds) map.fitBounds(bounds, { padding: 28, maxZoom: 13 });
    }
});

watch(() => props.modelValue, () => {
    const current = normalizeFormAddressValue(props.modelValue);
    const fallbackFields: Array<keyof FormAddressValue> = [
        'formatted', 'street', 'houseNumber', 'postcode', 'city', 'district',
        'state', 'country', 'countryCode', 'lat', 'lng'
    ];
    const isOwnFallback = current && pendingFallback
        ? fallbackFields.every(field => current[field] === pendingFallback?.[field])
        : false;
    if (pendingSelection && !isOwnFallback) {
        reverseSequence += 1;
        pendingSelection = null;
        pendingFallback = null;
        reversePending.value = false;
    }
    syncMarkerWithValue();
}, { deep: true });

watch(() => props.disabled, (disabled) => {
    marker?.setDraggable(!disabled && !unavailable.value);
    if (disabled) {
        reverseSequence += 1;
        pendingSelection = null;
        pendingFallback = null;
        reversePending.value = false;
    }
});

watch(() => colorMode.value, () => {
    queueStyleChange();
});

onMounted(async () => {
    destroyed = false;
    const container = mapContainer.value;
    if (styleCandidates.value.length === 0 || !container) {
        loading.value = false;
        unavailable.value = true;
        return;
    }
    try {
        const [{ Map, Marker }] = await Promise.all([
            import('maplibre-gl'),
            import('maplibre-gl/dist/maplibre-gl.css')
        ]);
        if (destroyed || mapContainer.value !== container) return;
        MarkerConstructor = Marker;
        const current = normalizeFormAddressValue(props.modelValue);
        const hasCoordinates = current?.lat !== undefined && current.lng !== undefined;
        map = new Map({
            container,
            style: { version: 8, sources: {}, layers: [] },
            center: hasCoordinates ? [current.lng!, current.lat!] : [10.4515, 51.1657],
            zoom: hasCoordinates ? 16 : 5,
            transformRequest: transformMapRequest
        });
        map.getCanvas().setAttribute('aria-label', t('form.address.mapLabel'));
        if (hasCoordinates) {
            marker = createMarker(Marker, !props.disabled)
                .setLngLat([current.lng!, current.lat!])
                .addTo(map);
            bindMarkerDrag();
        }
        const styleLoaded = await loadThemedStyle();
        if (destroyed || !styleLoaded || !map) {
            loading.value = false;
            unavailable.value = true;
            return;
        }
        mapReady.value = true;
        addBoundary();
        if (!hasCoordinates && props.boundary) {
            const bounds = jurisdictionBoundaryBounds(props.boundary);
            if (bounds) map.fitBounds(bounds, { padding: 28, maxZoom: 13 });
        }
        loading.value = false;
        unavailable.value = false;
        if (styleChangeQueued) void processStyleChanges();
        map.on('error', () => {
            if (!loading.value) return;
            loading.value = false;
            unavailable.value = true;
            mapReady.value = false;
        });
        map.on('click', (event: MapMouseEvent) => placeMarker(event.lngLat.lat, event.lngLat.lng));
    } catch {
        loading.value = false;
        unavailable.value = true;
    }
});

onBeforeUnmount(() => {
    destroyed = true;
    reverseSequence += 1;
    styleChangeQueued = false;
    cancelActiveStyleLoad?.();
    cancelActiveStyleLoad = null;
    marker?.remove();
    marker = null;
    MarkerConstructor = null;
    map?.remove();
    map = null;
    mapReady.value = false;
});
</script>

<template>
  <div
    :id="id"
    class="space-y-2"
  >
    <div
      ref="mapContainer"
      class="h-72 w-full overflow-hidden rounded-md border border-default bg-elevated"
      :aria-label="t('form.address.mapLabel')"
      :aria-busy="loading || styleChanging"
    />
    <p
      v-if="loading || styleChanging || reversePending"
      class="text-sm text-muted"
      aria-live="polite"
    >
      {{ loading || styleChanging ? t('form.address.mapLoading') : t('form.address.reverseLoading') }}
    </p>
    <UButton
      v-if="!unavailable"
      type="button"
      color="neutral"
      variant="soft"
      icon="i-lucide-crosshair"
      :disabled="disabled || !mapReady || styleChanging"
      :label="t('form.address.mapUseCenter')"
      @click="selectMapCenter"
    />
    <UAlert
      v-if="unavailable"
      role="status"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="t('form.address.mapUnavailable')"
    />
    <UAlert
      v-else-if="reverseFailed"
      role="status"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="t('form.address.reverseUnavailable')"
    />
    <p
      v-else
      class="text-sm text-muted"
    >
      {{ t('form.address.mapHint') }}
    </p>
  </div>
</template>

<style scoped>
:deep(.beantragt-location-marker-pulse) {
  transform-origin: 20px 20px;
}

@media (prefers-reduced-motion: no-preference) {
  :deep(.beantragt-location-marker-pulse) {
    animation: beantragt-location-marker-pulse 2s ease-in-out infinite;
  }
}

@keyframes beantragt-location-marker-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

:deep(.maplibregl-ctrl-attrib) {
  color: var(--ui-text-muted);
  background: color-mix(in srgb, var(--ui-bg) 88%, transparent);
}

:deep(.maplibregl-ctrl-attrib a) {
  color: var(--ui-text);
  text-decoration: underline;
}
</style>
