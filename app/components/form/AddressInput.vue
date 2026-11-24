<script setup lang="ts">
import { nextTick, onBeforeUnmount } from 'vue';
import type { FormAddressValue, GeocodingResult } from '~/types/form';
import {
    addressValueFromGeocodingResult,
    normalizeFormAddressValue
} from '~/utils/form-address';

const props = withDefaults(defineProps<{
    modelValue: unknown
    autocomplete?: boolean
    map?: boolean
    boundaryMode?: 'off' | 'advisory'
    jurisdictionSlug?: string | null
    initialQuery?: string
    disabled?: boolean
    readonly?: boolean
    label?: string
    required?: boolean
    error?: string
    /** Component fields are rendered and persisted by the parent FormRenderer. */
    externalFields?: boolean
}>(), {
    autocomplete: true,
    map: false,
    boundaryMode: 'off',
    jurisdictionSlug: null,
    disabled: false,
    readonly: false,
    label: '',
    required: false,
    error: '',
    externalFields: false
});
const emit = defineEmits<{ 'update:modelValue': [value: FormAddressValue | null] }>();

const { t, locale } = useI18n();
const { geocode } = useGeocoding();
const currentValue = computed(() => normalizeFormAddressValue(props.modelValue));
const query = ref(currentValue.value?.formatted || '');
const suggestions = ref<GeocodingResult[]>([]);
const searching = ref(false);
const searchFailed = ref(false);
const searchCompleted = ref(false);
const listOpen = ref(false);
const activeIndex = ref(-1);
const manual = ref(!props.autocomplete);
const selectionApplied = ref(false);
const lastAppliedFormatted = ref<string | null>(null);
const mapOpen = ref(false);
const manualFields = ref<HTMLElement | null>(null);
const requestSequence = ref(0);
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;
const {
    boundary,
    load: loadBoundary,
    contains: boundaryContains
} = useJurisdictionBoundary(() => props.jurisdictionSlug);

const componentId = useId();
const listboxId = `address-suggestions-${componentId}`;
const manualErrorId = `address-error-${componentId}`;
const manualPanelId = `address-manual-${componentId}`;
const mapPanelId = `address-map-${componentId}`;
const boundFormField = useFormField(props);
const inputId = computed(() => boundFormField.id.value || `address-input-${componentId}`);
const inputAriaAttrs = computed(() => boundFormField.ariaAttrs.value ?? {
    'aria-invalid': Boolean(props.error),
    'aria-describedby': props.error ? manualErrorId : undefined
});
const activeDescendant = computed(() => listOpen.value && activeIndex.value >= 0
    ? `${listboxId}-${activeIndex.value}`
    : undefined
);
const showNoResults = computed(() => searchCompleted.value
  && !searching.value
  && !searchFailed.value
  && query.value.trim().length >= 2
  && suggestions.value.length === 0
);
const hasPendingSelection = computed(() => Boolean(
    props.autocomplete
    && query.value.trim() !== (currentValue.value?.formatted ?? '')
));
const showManualToggle = computed(() => props.autocomplete && !props.externalFields && !props.readonly);
const showMapToggle = computed(() => props.map && !props.readonly);
const showAlternativeActions = computed(() => showManualToggle.value || showMapToggle.value);
const outsideBoundary = computed(() => {
    const value = currentValue.value;
    if (props.boundaryMode !== 'advisory' || value?.lat === undefined || value.lng === undefined) return false;
    return boundaryContains(value.lat, value.lng) === false;
});

watch(() => props.modelValue, (value, previous) => {
    const normalized = normalizeFormAddressValue(value);
    if (normalized?.formatted !== lastAppliedFormatted.value) {
        selectionApplied.value = false;
        lastAppliedFormatted.value = null;
    }
    if (normalized?.formatted && normalized.formatted !== query.value) {
        query.value = normalized.formatted;
    } else if (!normalized) {
        const previousAddress = normalizeFormAddressValue(previous);
        if (previousAddress?.formatted === query.value) query.value = '';
    }
});

watch(() => props.autocomplete, (enabled) => {
    if (!enabled) manual.value = true;
});

watch(() => props.initialQuery, (value, previous) => {
    if (value?.trim() !== previous?.trim()) applyInitialQuery(value);
});

watch(
    () => [props.boundaryMode, props.jurisdictionSlug, props.readonly] as const,
    ([mode, slug, readonly]) => {
        if (mode === 'advisory' && slug && !readonly) void loadBoundary();
    },
    { immediate: true }
);

onBeforeUnmount(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (closeTimer) clearTimeout(closeTimer);
});

onMounted(() => {
    applyInitialQuery(props.initialQuery);
});

function applyInitialQuery(value: string | undefined): void {
    const initialQuery = value?.trim();
    if (currentValue.value || !props.autocomplete || !initialQuery || initialQuery.length < 2) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    requestSequence.value += 1;
    searching.value = false;
    suggestions.value = [];
    activeIndex.value = -1;
    query.value = initialQuery;
    void runSearch(initialQuery);
}

function onQueryInput(value: string | number | undefined): void {
    requestSequence.value += 1;
    searching.value = false;
    query.value = String(value ?? '');
    suggestions.value = [];
    activeIndex.value = -1;
    searchCompleted.value = false;
    searchFailed.value = false;
    selectionApplied.value = false;
    lastAppliedFormatted.value = null;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (query.value.trim().length < 2) {
        listOpen.value = false;
        return;
    }
    debounceTimer = setTimeout(() => void runSearch(query.value), 300);
}

async function runSearch(text: string): Promise<void> {
    const sequence = ++requestSequence.value;
    searching.value = true;
    searchFailed.value = false;
    searchCompleted.value = false;
    try {
        const results = await geocode(text.trim(), { language: locale.value });
        if (sequence !== requestSequence.value) return;
        suggestions.value = results;
        listOpen.value = results.length > 0;
        activeIndex.value = results.length > 0 ? 0 : -1;
        searchCompleted.value = true;
    } catch {
        if (sequence !== requestSequence.value) return;
        suggestions.value = [];
        listOpen.value = false;
        searchFailed.value = true;
        searchCompleted.value = true;
        if (!props.externalFields) {
            manual.value = true;
            await nextTick();
            manualFields.value?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus();
        }
    } finally {
        if (sequence === requestSequence.value) searching.value = false;
    }
}

function selectSuggestion(result: GeocodingResult): void {
    const value = addressValueFromGeocodingResult(result);
    if (!value) return;
    requestSequence.value += 1;
    emit('update:modelValue', value);
    query.value = value.formatted;
    suggestions.value = [];
    listOpen.value = false;
    activeIndex.value = -1;
    searchCompleted.value = false;
    lastAppliedFormatted.value = value.formatted;
    selectionApplied.value = true;
}

function onKeydown(event: KeyboardEvent): void {
    if (!listOpen.value || suggestions.value.length === 0) {
        if (suggestions.value.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            listOpen.value = true;
            activeIndex.value = event.key === 'ArrowUp' ? suggestions.value.length - 1 : 0;
            void scrollActiveSuggestionIntoView();
        } else if (event.key === 'Escape') {
            listOpen.value = false;
            activeIndex.value = -1;
        }
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeIndex.value = (activeIndex.value + 1) % suggestions.value.length;
        void scrollActiveSuggestionIntoView();
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeIndex.value = (activeIndex.value - 1 + suggestions.value.length) % suggestions.value.length;
        void scrollActiveSuggestionIntoView();
    } else if (event.key === 'Enter' && activeIndex.value >= 0) {
        event.preventDefault();
        const result = suggestions.value[activeIndex.value];
        if (result) selectSuggestion(result);
    } else if (event.key === 'Escape') {
        event.preventDefault();
        listOpen.value = false;
        activeIndex.value = -1;
    }
}

function onFocus(): void {
    if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = undefined;
    }
    if (suggestions.value.length === 0) return;
    listOpen.value = true;
    activeIndex.value = Math.max(activeIndex.value, 0);
}

async function scrollActiveSuggestionIntoView(): Promise<void> {
    await nextTick();
    if (activeIndex.value < 0) return;
    document.getElementById(`${listboxId}-${activeIndex.value}`)?.scrollIntoView({ block: 'nearest' });
}

function onBlur(): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
    }
    requestSequence.value += 1;
    searching.value = false;
    listOpen.value = false;
    activeIndex.value = -1;
    if (hasPendingSelection.value) {
        query.value = currentValue.value?.formatted ?? '';
        suggestions.value = [];
        searchCompleted.value = false;
        searchFailed.value = false;
    }
    closeTimer = setTimeout(() => {
        listOpen.value = false;
        activeIndex.value = -1;
    }, 150);
}

function manualPart(key: keyof FormAddressValue): string {
    const value = currentValue.value?.[key];
    return typeof value === 'string' ? value : '';
}

function updateManualPart(key: 'street' | 'houseNumber' | 'postcode' | 'city', value: string | number | undefined): void {
    const previous = currentValue.value;
    const next = normalizeFormAddressValue({
        street: previous?.street,
        houseNumber: previous?.houseNumber,
        postcode: previous?.postcode,
        city: previous?.city,
        district: previous?.district,
        state: previous?.state,
        country: previous?.country,
        countryCode: previous?.countryCode,
        formatted: '',
        [key]: String(value ?? '')
    });
    emit('update:modelValue', next);
    query.value = next?.formatted || '';
}
</script>

<template>
  <div class="space-y-3">
    <div
      v-if="autocomplete && (externalFields || !manual)"
      class="relative"
    >
      <UInput
        :id="inputId"
        :model-value="query"
        :placeholder="t('form.address.searchPlaceholder')"
        :disabled="disabled"
        :readonly="readonly"
        :required="required && !externalFields"
        v-bind="inputAriaAttrs"
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="listOpen"
        :aria-controls="listOpen ? listboxId : undefined"
        :aria-activedescendant="activeDescendant"
        class="w-full"
        @update:model-value="onQueryInput"
        @keydown="onKeydown"
        @focus="onFocus"
        @blur="onBlur"
      />
      <ul
        v-if="listOpen"
        :id="listboxId"
        role="listbox"
        class="mt-1 max-h-48 w-full overflow-auto rounded-md border border-default bg-default p-1 shadow-lg"
      >
        <li
          v-for="(suggestion, index) in suggestions"
          :id="`${listboxId}-${index}`"
          :key="`${suggestion.lat}:${suggestion.lng}:${suggestion.displayName}`"
          role="option"
          :aria-selected="activeIndex === index"
          class="cursor-pointer rounded px-3 py-2 text-sm text-highlighted"
          :class="{ 'bg-elevated': activeIndex === index }"
          @mouseenter="activeIndex = index"
          @mousedown.prevent="selectSuggestion(suggestion)"
          @click="selectSuggestion(suggestion)"
        >
          {{ suggestion.displayName }}
        </li>
      </ul>
      <p class="mt-1 text-sm text-muted">
        {{ t('form.address.searchHint') }}
      </p>
    </div>

    <p
      v-if="selectionApplied && externalFields"
      aria-live="polite"
      class="text-sm text-success"
    >
      {{ t('form.address.applied') }}
    </p>
    <p
      v-else-if="hasPendingSelection"
      role="status"
      class="text-sm text-muted"
    >
      {{ t('form.address.pendingSelection') }}
    </p>

    <p
      v-if="searching"
      aria-live="polite"
      class="text-sm text-muted"
    >
      {{ t('form.address.searching') }}
    </p>
    <UAlert
      v-else-if="searchFailed"
      role="status"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="t('form.address.unavailable')"
    />
    <p
      v-else-if="showNoResults"
      aria-live="polite"
      class="text-sm text-muted"
    >
      {{ t('form.address.noResults') }}
    </p>

    <div
      v-if="showAlternativeActions"
      data-testid="address-actions"
      class="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-center"
    >
      <UButton
        v-if="showManualToggle"
        type="button"
        color="neutral"
        variant="soft"
        :icon="manual ? 'i-lucide-search' : 'i-lucide-keyboard'"
        class="justify-start sm:justify-center"
        :disabled="disabled"
        :label="manual ? t('form.address.manualClose') : t('form.address.manualOpen')"
        :aria-expanded="manual"
        :aria-controls="manualPanelId"
        @click="manual = !manual"
      />

      <UButton
        v-if="showMapToggle"
        type="button"
        color="neutral"
        variant="soft"
        :icon="mapOpen ? 'i-lucide-map-pin-off' : 'i-lucide-map-pin'"
        class="justify-start sm:justify-center"
        :disabled="disabled"
        :label="mapOpen ? t('form.address.mapClose') : t('form.address.mapOpen')"
        :aria-expanded="mapOpen"
        :aria-controls="mapPanelId"
        @click="mapOpen = !mapOpen"
      />
    </div>

    <FormAddressMapPicker
      v-if="map && mapOpen"
      :id="mapPanelId"
      :model-value="currentValue"
      :boundary="boundary"
      :disabled="disabled || readonly"
      @update:model-value="emit('update:modelValue', $event)"
    />

    <UAlert
      v-if="outsideBoundary"
      role="status"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="t('form.address.outsideBoundary')"
    />

    <fieldset
      v-if="manual && !externalFields"
      :id="manualPanelId"
      ref="manualFields"
      :aria-label="label ? `${label}: ${t('form.address.manualTitle')}` : t('form.address.manualTitle')"
      :aria-required="required"
      :aria-invalid="Boolean(error)"
      :aria-describedby="error ? manualErrorId : undefined"
      class="grid grid-cols-1 gap-3 rounded-md border border-default p-3 sm:grid-cols-2"
    >
      <legend class="px-1 text-sm font-medium text-highlighted">
        {{ t('form.address.manualTitle') }}
      </legend>
      <UFormField :label="t('form.address.street')">
        <UInput
          :id="inputId"
          :model-value="manualPart('street')"
          autocomplete="address-line1"
          :disabled="disabled"
          :readonly="readonly"
          :required="required"
          v-bind="inputAriaAttrs"
          class="w-full"
          @update:model-value="updateManualPart('street', $event)"
        />
      </UFormField>
      <UFormField :label="t('form.address.houseNumber')">
        <UInput
          :model-value="manualPart('houseNumber')"
          autocomplete="address-line2"
          :disabled="disabled"
          :readonly="readonly"
          class="w-full"
          @update:model-value="updateManualPart('houseNumber', $event)"
        />
      </UFormField>
      <UFormField :label="t('form.address.postcode')">
        <UInput
          :model-value="manualPart('postcode')"
          autocomplete="postal-code"
          inputmode="numeric"
          :disabled="disabled"
          :readonly="readonly"
          class="w-full"
          @update:model-value="updateManualPart('postcode', $event)"
        />
      </UFormField>
      <UFormField :label="t('form.address.city')">
        <UInput
          :model-value="manualPart('city')"
          autocomplete="address-level2"
          :disabled="disabled"
          :readonly="readonly"
          class="w-full"
          @update:model-value="updateManualPart('city', $event)"
        />
      </UFormField>
      <p
        v-if="error"
        :id="manualErrorId"
        class="sr-only"
      >
        {{ error }}
      </p>
    </fieldset>
  </div>
</template>
