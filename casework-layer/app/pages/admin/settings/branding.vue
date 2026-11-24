<script setup lang="ts">
/**
 * Branding Settings Page (P4.4 Config-as-Content)
 *
 * Loads the `branding` config section (primaryColor, secondaryColor,
 * customCss, logoDataUrl, logoAlt) for the current jurisdiction workspace from
 * the Drupal-backed proxy and persists the edited subset via PATCH.
 *
 * The `neutralColor` section field is not surfaced because this UI has no
 * neutral-color control.
 */
import { staffFetch } from '~~/casework-layer/app/composables/api/useStaffSessionFetch';
import { SETTINGS_SECTION_REFUSAL_CODES, useSettingsLoadState } from '~~/casework-layer/app/composables/useSettingsLoadState';
import SettingsLoadNotice from '~~/casework-layer/app/components/admin/SettingsLoadNotice.vue';
import AppCard from '~/components/app/Card.vue';
import { svgLogoColorModes } from '~/utils/svg-logo-color-modes';
import { refreshPublicJurisdictionConfigs } from '~/composables/usePublicJurisdictionConfig';

definePageMeta({
    layout: 'dashboard',
    middleware: 'admin'
});

const { t } = useI18n();
const { workspaceRoute, selectedWorkspaceSlug, loadWorkspaces } = useWorkspaceContext();

useHead({
    title: computed(() => `${t('admin.settings.branding.label')} - ${t('common.settings')} - beantragt.ai`)
});

const toast = useToast();

interface BrandingSectionData {
    primaryColor?: string
    secondaryColor?: string
    neutralColor?: string
    customCss?: string
    logoDataUrl?: string
    /** Optional logo for the dark view of the screen pages (mails, letterhead and print use `logoDataUrl`). */
    logoDarkDataUrl?: string
    logoAlt?: string
}

// Backend PATCH is a MERGE patch: keys absent from the body are never nulled
// (the server guards each field with array_key_exists). This page edits the
// color, logo and customCss subset, so the section's neutralColor is left
// untouched server-side and is not tracked client-side.

// ── Color State ─────────────────────────────────────────────────
// `tailwind` is carried for parity with the backend palette-name support; the
// UI persists the hex value. Preset labels render from i18n colorPresets keys.

const PRESET_COLORS = [
    { labelKey: 'blue', value: '#2563eb', tailwind: 'blue' },
    { labelKey: 'green', value: '#16a34a', tailwind: 'green' },
    { labelKey: 'red', value: '#dc2626', tailwind: 'red' },
    { labelKey: 'orange', value: '#ea580c', tailwind: 'orange' },
    { labelKey: 'violet', value: '#7c3aed', tailwind: 'violet' },
    { labelKey: 'cyan', value: '#0891b2', tailwind: 'cyan' },
    { labelKey: 'pink', value: '#db2777', tailwind: 'pink' },
    { labelKey: 'amber', value: '#d97706', tailwind: 'amber' }
] as const;

const primaryColor = ref('#2563eb');
const secondaryColor = ref('#7c3aed');
const customCss = ref('');
// "Eigenes CSS" is a closed card that opens by itself when it holds text.
const customCssOpen = ref(false);

// Logo state. Empty string removes the persisted logo on save.
const logoDataUrl = ref('');
/**
 * An SVG that styles itself for dark mode stands without the plate in its dark
 * form, as the citizen header shows it (`MunicipalityBrand`); also for an
 * upload that is not saved yet. Both forms are pictures only (`<img src>`).
 */
/** A derived picture that did not load: the original on its plate instead. */
const failedLogoForms = ref<ReadonlySet<string>>(new Set());
function onDerivedLogoError(event: Event) {
    const src = (event.currentTarget as HTMLImageElement | null)?.getAttribute('src');
    if (src && !failedLogoForms.value.has(src)) failedLogoForms.value = new Set([...failedLogoForms.value, src]);
}
const logoModes = computed(() => {
    const modes = svgLogoColorModes(logoDataUrl.value);
    return modes && !failedLogoForms.value.has(modes.light) && !failedLogoForms.value.has(modes.dark) ? modes : null;
});
const logoLightSrc = computed(() => logoModes.value?.light || logoDataUrl.value);

/**
 * Own logo for the dark view. Empty string removes it on save. It is sent only when the person
 * changed it or the server already returned the key, so a save against a backend without the key
 * stays as it was.
 */
const logoDarkDataUrl = ref('');
const serverKnowsLogoDark = ref(false);
const logoDarkFileInput = ref<HTMLInputElement | null>(null);
/** Which of the three cases of the dark view applies; a dark logo without a logo shows nothing. */
const darkLogoCase = computed<'own' | 'derived' | 'plate' | 'none'>(() => {
    if (!logoDataUrl.value) return 'none';
    // An own dark logo that does not load puts the logo on its plate, as in the header.
    if (logoDarkDataUrl.value) return failedLogoForms.value.has(logoDarkDataUrl.value) ? 'plate' : 'own';
    if (logoModes.value) return 'derived';
    return 'plate';
});
/** The picture of the dark view: own dark logo, else the derived dark form; null for the plate. */
const logoDarkViewSrc = computed(() => {
    if (darkLogoCase.value === 'own') return logoDarkDataUrl.value;
    if (darkLogoCase.value === 'derived') return logoModes.value!.dark;
    return null;
});
const darkLogoSentenceKey = computed(() => ({
    own: 'admin.settings.branding.logoDarkUploaded',
    derived: 'admin.settings.branding.logoDarkOwn',
    plate: 'admin.settings.branding.logoDarkFallback',
    none: 'admin.settings.branding.logoDarkFallback'
})[darkLogoCase.value]);
const logoAlt = ref('');
const logoFileInput = ref<HTMLInputElement | null>(null);

// Track initial values for dirty detection
const initialState = ref({ primary: '', secondary: '', css: '', logo: '', logoDark: '', logoAlt: '' });

// A refused load shows its reason without retry and without the form; a page
// that never loaded has nothing to lose, so the leave guard stays quiet.
const {
    refusal: loadRefusal,
    retryable: loadRetryable,
    loaded: settingsLoaded,
    begin: beginLoad,
    succeed: loadSucceeded,
    fail: loadFailed,
    failLocally: loadFailedLocally
} = useSettingsLoadState({ refusalCodes: SETTINGS_SECTION_REFUSAL_CODES });

const isDirty = computed(() => {
    if (!settingsLoaded.value) return false;
    return primaryColor.value !== initialState.value.primary
      || secondaryColor.value !== initialState.value.secondary
      || customCss.value !== initialState.value.css
      || logoDataUrl.value !== initialState.value.logo
      || logoDarkDataUrl.value !== initialState.value.logoDark
      || logoAlt.value !== initialState.value.logoAlt;
});

const isSaving = ref(false);
const isLoading = ref(true);
const loadError = ref<string | null>(null);

// ── Color Validation ────────────────────────────────────────────
// The free-text inputs accept anything; validate to a hex code, a known preset
// value, or a Tailwind palette name before allowing a save, and surface an
// inline field error. Mirrors the backend allowlist in
// JurisdictionConfigValidator (VALID_TAILWIND_PALETTES + #RGB/#RRGGBB).
const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const PRESET_VALUES = new Set(PRESET_COLORS.map(c => c.value));
const TAILWIND_PALETTES = new Set([
    'slate', 'gray', 'zinc', 'neutral', 'stone',
    'mauve', 'olive', 'mist', 'taupe',
    'red', 'orange', 'amber', 'yellow', 'lime',
    'green', 'emerald', 'teal', 'cyan', 'sky',
    'blue', 'indigo', 'violet', 'purple', 'fuchsia',
    'pink', 'rose'
]);

const colorErrors = reactive<{ primary: string | undefined, secondary: string | undefined }>({
    primary: undefined,
    secondary: undefined
});

function isValidColor(value: string): boolean {
    return HEX_PATTERN.test(value)
      || PRESET_VALUES.has(value as typeof PRESET_COLORS[number]['value'])
      || TAILWIND_PALETTES.has(value);
}

watch(primaryColor, () => {
    colorErrors.primary = undefined;
});
watch(secondaryColor, () => {
    colorErrors.secondary = undefined;
});

// The two colour fields share one layout: label, sentence, picker, hex, presets.
const colorSlots = computed(() => [
    {
        key: 'primary' as const,
        label: t('admin.settings.branding.primaryColor'),
        description: t('admin.settings.branding.primaryColorDescription'),
        groupLabel: t('admin.settings.branding.primaryColorGroupAria'),
        placeholder: '#2563eb',
        value: primaryColor.value,
        error: colorErrors.primary,
        set: (value: string) => {
            primaryColor.value = value;
        }
    },
    {
        key: 'secondary' as const,
        label: t('admin.settings.branding.secondaryColor'),
        description: t('admin.settings.branding.secondaryColorDescription'),
        groupLabel: t('admin.settings.branding.secondaryColorGroupAria'),
        placeholder: '#7c3aed',
        value: secondaryColor.value,
        error: colorErrors.secondary,
        set: (value: string) => {
            secondaryColor.value = value;
        }
    }
]);

function takeSnapshot() {
    initialState.value = {
        primary: primaryColor.value,
        secondary: secondaryColor.value,
        css: customCss.value,
        logo: logoDataUrl.value,
        logoDark: logoDarkDataUrl.value,
        logoAlt: logoAlt.value
    };
}

useUnsavedChangesGuard(isDirty);

// ── Logo Handling ───────────────────────────────────────────────

function triggerLogoUpload() {
    logoFileInput.value?.click();
}

/** The same file checks and size limit for both logos; returns the file or null after a message. */
function acceptedLogoFile(event: Event): File | null {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) return null;

    const allowedTypes = ['image/svg+xml', 'image/png', 'image/jpeg'];
    if (!allowedTypes.includes(file.type)) {
        toast.add({ title: t('admin.settings.branding.logoTypeError'), color: 'error' });
        return null;
    }
    if (file.size > 500 * 1024) {
        toast.add({ title: t('admin.settings.branding.logoSizeError'), color: 'error' });
        return null;
    }
    return file;
}

function handleLogoChange(event: Event) {
    const file = acceptedLogoFile(event);
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        logoDataUrl.value = e.target?.result as string;
        if (!logoAlt.value.trim()) {
            logoAlt.value = file.name.replace(/\.[^.]+$/, '').slice(0, 160);
        }
    };
    reader.readAsDataURL(file);
}

function triggerLogoDarkUpload() {
    logoDarkFileInput.value?.click();
}

function handleLogoDarkChange(event: Event) {
    const file = acceptedLogoFile(event);
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        logoDarkDataUrl.value = e.target?.result as string;
    };
    reader.readAsDataURL(file);
}

function removeLogoDark() {
    logoDarkDataUrl.value = '';
}

function removeLogo() {
    logoDataUrl.value = '';
    // The dark logo belongs to the logo: it goes with it in the same save.
    logoDarkDataUrl.value = '';
}

// ── Load + Save ─────────────────────────────────────────────────

function applySection(data: BrandingSectionData) {
    if (typeof data.primaryColor === 'string' && data.primaryColor) {
        primaryColor.value = data.primaryColor;
    }
    if (typeof data.secondaryColor === 'string' && data.secondaryColor) {
        secondaryColor.value = data.secondaryColor;
    }
    customCss.value = typeof data.customCss === 'string' ? data.customCss : '';
    customCssOpen.value = customCss.value.trim() !== '';
    logoDataUrl.value = typeof data.logoDataUrl === 'string' ? data.logoDataUrl : '';
    serverKnowsLogoDark.value = Object.prototype.hasOwnProperty.call(data, 'logoDarkDataUrl');
    logoDarkDataUrl.value = typeof data.logoDarkDataUrl === 'string' ? data.logoDarkDataUrl : '';
    logoAlt.value = typeof data.logoAlt === 'string' ? data.logoAlt : '';
}

async function loadSettings() {
    isLoading.value = true;
    loadError.value = null;
    beginLoad();

    // Branding applies to the jurisdiction (not the org segment).
    if (!selectedWorkspaceSlug.value) {
        await loadWorkspaces();
    }
    const slug = selectedWorkspaceSlug.value;
    if (!slug) {
        loadError.value = t('admin.settings.selectWorkspace');
        loadFailedLocally();
        isLoading.value = false;
        return;
    }

    try {
        const response = await staffFetch<{ section: string, data: BrandingSectionData }>(
            `/api/admin/jurisdictions/${slug}/settings/branding`
        );
        applySection(response.data || {});
        takeSnapshot();
        loadSucceeded();
    } catch (e: unknown) {
        if (loadFailed(e) === 'technical') {
            loadError.value = t('admin.settings.branding.loadError');
        }
    } finally {
        isLoading.value = false;
    }
}

/** Surface a backend color field error inline; returns true when handled. */
function applyColorFieldError(field: string | null, detail: string | null): boolean {
    const message = detail || t('admin.settings.branding.colorInvalid');
    if (field === 'primaryColor') {
        colorErrors.primary = message;
        focusColorInput('settings-branding-primaryColor');
        return true;
    }
    if (field === 'secondaryColor') {
        colorErrors.secondary = message;
        focusColorInput('settings-branding-secondaryColor');
        return true;
    }
    return false;
}

function focusColorInput(id: string) {
    nextTick(() => {
        if (!import.meta.client) return;
        document.getElementById(id)?.focus();
    });
}

async function handleSave() {
    colorErrors.primary = undefined;
    colorErrors.secondary = undefined;

    let hasError = false;
    if (!isValidColor(primaryColor.value)) {
        colorErrors.primary = t('admin.settings.branding.colorInvalid');
        hasError = true;
    }
    if (!isValidColor(secondaryColor.value)) {
        colorErrors.secondary = t('admin.settings.branding.colorInvalid');
        hasError = true;
    }
    if (hasError) {
        focusColorInput(colorErrors.primary
            ? 'settings-branding-primaryColor'
            : 'settings-branding-secondaryColor');
        return;
    }

    const slug = selectedWorkspaceSlug.value;
    if (!slug) {
        toast.add({
            title: t('admin.settings.selectWorkspace'),
            icon: 'i-lucide-circle-x',
            color: 'error'
        });
        return;
    }

    isSaving.value = true;

    try {
        const response = await staffFetch<{ section: string, data: BrandingSectionData }>(
            `/api/admin/jurisdictions/${slug}/settings/branding`,
            {
                method: 'PATCH',
                body: {
                    data: {
                        primaryColor: primaryColor.value,
                        secondaryColor: secondaryColor.value,
                        customCss: customCss.value,
                        logoDataUrl: logoDataUrl.value,
                        ...(serverKnowsLogoDark.value || logoDarkDataUrl.value !== initialState.value.logoDark
                            ? { logoDarkDataUrl: logoDarkDataUrl.value }
                            : {}),
                        logoAlt: logoAlt.value.trim()
                    }
                }
            }
        );
        applySection(response.data || {});
        takeSnapshot();
        // Header and sidebar read the public config: take the saved logo and colours at once (glogo6).
        void refreshPublicJurisdictionConfigs(slug);

        toast.add({
            title: t('common.success'),
            description: t('admin.settings.branding.saved'),
            color: 'success'
        });
    } catch (e: unknown) {
        const { status, field, detail } = parseSettingsError(e);

        if (status === 401) {
            return;
        }

        if (applyColorFieldError(field, detail)) return;

        toast.add({
            title: t('admin.settings.branding.saveError'),
            description: detail || undefined,
            icon: 'i-lucide-circle-x',
            color: 'error'
        });
    } finally {
        isSaving.value = false;
    }
}

onMounted(() => {
    loadSettings();
});
</script>

<template>
  <AppPageLayout
    :title="t('admin.settings.branding.title')"
    :description="t('admin.settings.branding.subtitle')"
    :breadcrumbs="[{ label: t('common.settings'), to: workspaceRoute('/admin/settings') }, { label: t('admin.settings.branding.label') }]"
  >
    <!-- Hidden file input -->
    <input
      ref="logoFileInput"
      type="file"
      accept=".svg,.png,.jpg,.jpeg"
      class="hidden"
      :aria-label="t('admin.settings.branding.logoUploadAria')"
      @change="handleLogoChange"
    >
    <input
      ref="logoDarkFileInput"
      type="file"
      accept=".svg,.png,.jpg,.jpeg"
      class="hidden"
      :aria-label="t('admin.settings.branding.uploadLogoDark')"
      data-testid="branding-logo-dark-input"
      @change="handleLogoDarkChange"
    >
    <!-- Loading state -->
    <div
      v-if="isLoading"
      class="space-y-4"
    >
      <USkeleton class="h-9 w-full max-w-xl" />
      <USkeleton class="h-9 w-full max-w-xl" />
      <USkeleton class="h-9 w-full max-w-xl" />
    </div>

    <!-- Refused load (reason, no retry) or technical error (retry) -->
    <SettingsLoadNotice
      v-else-if="loadRefusal || loadError"
      :refusal="loadRefusal"
      :error="loadError"
      :retryable="loadRetryable"
      @retry="loadSettings"
    />

    <!-- One form card like 22 and the preview  -->
    <div
      v-else
      class="grid gap-6 lg:grid-cols-3"
    >
      <AppCard
        class="w-full min-w-0 max-w-3xl lg:col-span-2"
        data-testid="branding-form-card"
      >
        <div class="space-y-8">
          <!-- Logo: the one logo where it stands in light and in dark mode -->
          <section
            class="space-y-4"
            aria-labelledby="branding-logo-heading"
            data-testid="branding-logo"
          >
            <h3
              id="branding-logo-heading"
              class="text-sm font-semibold text-highlighted"
            >
              {{ t('admin.settings.branding.logo') }}
            </h3>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-3">
                <p class="text-sm text-muted">
                  {{ t('admin.settings.branding.logoLightPlace') }}
                </p>
                <!-- Fixed background on purpose: the box shows the logo where it will stand. -->
                <div
                  class="flex h-24 items-center justify-center rounded-md bg-white p-4 ring ring-default"
                  data-testid="branding-logo-light"
                >
                  <img
                    v-if="logoDataUrl"
                    :src="logoLightSrc"
                    :alt="logoAlt || t('admin.settings.branding.logoAlt')"
                    class="h-10 w-auto max-w-48 object-contain"
                    @error="onDerivedLogoError"
                  >
                  <span
                    v-else
                    class="text-sm text-neutral-600"
                  >{{ t('admin.settings.branding.noLogo') }}</span>
                </div>
                <div class="flex flex-wrap gap-2">
                  <UButton
                    icon="i-lucide-upload"
                    color="neutral"
                    variant="outline"
                    data-testid="branding-logo-upload"
                    @click="triggerLogoUpload"
                  >
                    {{ t('admin.settings.branding.uploadLogo') }}
                  </UButton>
                  <UButton
                    v-if="logoDataUrl"
                    icon="i-lucide-trash-2"
                    color="neutral"
                    variant="ghost"
                    data-testid="branding-logo-remove"
                    @click="removeLogo"
                  >
                    {{ t('common.remove') }}
                  </UButton>
                </div>
                <p
                  class="mt-2 text-sm text-muted"
                  data-testid="branding-logo-hint"
                >
                  {{ t('admin.settings.branding.logoHint') }}
                </p>
              </div>
              <div class="space-y-3">
                <p class="text-sm text-muted">
                  {{ t('admin.settings.branding.logoDarkPlace') }}
                </p>
                <!-- Own dark logo, else the derived dark form of a self-styled SVG, else the logo on the white plate. -->
                <div
                  class="flex h-24 items-center justify-center rounded-md bg-neutral-900 p-4 ring ring-default"
                  data-testid="branding-logo-dark"
                  :data-case="darkLogoCase"
                >
                  <img
                    v-if="logoDarkViewSrc"
                    :src="logoDarkViewSrc"
                    alt=""
                    class="h-10 w-auto max-w-48 object-contain"
                    data-testid="branding-logo-dark-own"
                    @error="onDerivedLogoError"
                  >
                  <span
                    v-else-if="logoDataUrl"
                    class="inline-flex items-center rounded-md bg-white px-2.5 py-1.5"
                  >
                    <img
                      :src="logoDataUrl"
                      alt=""
                      class="h-10 w-auto max-w-48 object-contain"
                    >
                  </span>
                  <span
                    v-else
                    class="text-sm text-neutral-400"
                  >{{ t('admin.settings.branding.noLogo') }}</span>
                </div>
                <!-- A dark logo needs the logo: without one there is nothing to upload it for. -->
                <div
                  v-if="logoDataUrl"
                  class="flex flex-wrap gap-2"
                >
                  <UButton
                    icon="i-lucide-upload"
                    color="neutral"
                    variant="outline"
                    data-testid="branding-logo-dark-upload"
                    @click="triggerLogoDarkUpload"
                  >
                    {{ t('admin.settings.branding.uploadLogoDark') }}
                  </UButton>
                  <UButton
                    v-if="logoDarkDataUrl"
                    icon="i-lucide-trash-2"
                    color="neutral"
                    variant="ghost"
                    data-testid="branding-logo-dark-remove"
                    @click="removeLogoDark"
                  >
                    {{ t('common.remove') }}
                  </UButton>
                </div>
                <p
                  class="max-w-prose text-sm text-muted"
                  data-testid="branding-logo-dark-sentence"
                >
                  {{ t(darkLogoSentenceKey) }}
                </p>
              </div>
            </div>
            <UFormField
              :label="t('admin.settings.branding.logoAltLabel')"
              :description="t('admin.settings.branding.logoAltDescription')"
              name="logoAlt"
            >
              <UInput
                v-model="logoAlt"
                :placeholder="t('admin.settings.branding.logoAltPlaceholder')"
                :maxlength="160"
                class="w-full max-w-xl"
              />
            </UFormField>
          </section>

          <!-- Colours: one field per colour, presets as swatches -->
          <section
            class="space-y-4"
            aria-labelledby="branding-colors-heading"
            data-testid="branding-colors"
          >
            <h3
              id="branding-colors-heading"
              class="text-sm font-semibold text-highlighted"
            >
              {{ t('admin.settings.branding.colors') }}
            </h3>
            <UFormField
              v-for="slot in colorSlots"
              :key="slot.key"
              :label="slot.label"
              :description="slot.description"
              :name="`${slot.key}Color`"
            >
              <div class="flex flex-wrap items-center gap-2">
                <input
                  :value="slot.value"
                  type="color"
                  class="size-8 cursor-pointer rounded-md border border-default bg-transparent p-0.5"
                  :title="t('admin.settings.branding.colorPickerAria')"
                  :aria-label="t('admin.settings.branding.colorPickerAria')"
                  @input="slot.set(($event.target as HTMLInputElement).value)"
                >
                <UInput
                  :id="`settings-branding-${slot.key}Color`"
                  :model-value="slot.value"
                  :placeholder="slot.placeholder"
                  class="w-32 font-mono"
                  :aria-label="t('admin.settings.branding.colorHexAria')"
                  :aria-invalid="Boolean(slot.error)"
                  :aria-describedby="slot.error ? `settings-branding-${slot.key}Color-error` : undefined"
                  @update:model-value="slot.set(String($event ?? ''))"
                />
                <div
                  class="flex flex-wrap items-center gap-2"
                  role="group"
                  :aria-label="slot.groupLabel"
                  :data-testid="`branding-${slot.key}-presets`"
                >
                  <UTooltip
                    v-for="color in PRESET_COLORS"
                    :key="color.value"
                    :text="t(`admin.settings.branding.colorPresets.${color.labelKey}`)"
                  >
                    <button
                      type="button"
                      class="size-6 rounded-full ring-1 ring-accented transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      :class="slot.value === color.value ? 'ring-2 ring-primary ring-offset-2 ring-offset-default' : undefined"
                      :style="{ backgroundColor: color.value }"
                      :aria-label="t(`admin.settings.branding.colorPresets.${color.labelKey}`)"
                      :aria-pressed="slot.value === color.value"
                      @click="slot.set(color.value)"
                    />
                  </UTooltip>
                </div>
              </div>
              <p
                v-if="slot.error"
                :id="`settings-branding-${slot.key}Color-error`"
                class="mt-2 text-sm text-error"
              >
                {{ slot.error }}
              </p>
            </UFormField>
          </section>

          <!-- Eigenes CSS: a closed part of the card, open by itself when CSS is stored -->
          <UCollapsible
            v-model:open="customCssOpen"
            :unmount-on-hide="false"
            data-testid="branding-css"
          >
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-chevron-right"
              class="group -ms-2.5"
              :ui="{ leadingIcon: 'transition-transform group-data-[state=open]:rotate-90' }"
              data-testid="branding-css-toggle"
            >
              {{ t('admin.settings.branding.customCss') }}
            </UButton>
            <template #content>
              <div class="pt-3">
                <UFormField
                  :label="t('admin.settings.branding.customCss')"
                  :description="t('admin.settings.branding.customCssDescription')"
                  name="customCss"
                >
                  <UTextarea
                    v-model="customCss"
                    :rows="10"
                    class="w-full font-mono text-sm"
                    placeholder="/* CSS */
:root {
  --custom-bg: #f5f5f5;
}"
                  />
                </UFormField>
              </div>
            </template>
          </UCollapsible>
        </div>

        <template #footer>
          <UButton
            :loading="isSaving"
            :disabled="!isDirty"
            data-testid="branding-save"
            @click="handleSave"
          >
            {{ t('admin.settings.branding.save') }}
          </UButton>
        </template>
      </AppCard>

      <!-- Preview: a small, true citizen page with the unsaved logo and colour -->
      <div class="min-w-0 lg:sticky lg:top-6 lg:col-span-1 lg:self-start">
        <AppCard
          :title="t('admin.settings.branding.preview')"
          data-testid="branding-preview-card"
        >
          <p class="sr-only">
            {{ t('admin.settings.branding.previewNote') }}
          </p>
          <div
            inert
            aria-hidden="true"
            class="space-y-4"
            :style="{ '--ui-primary': primaryColor }"
            data-testid="branding-preview"
          >
            <div class="border-b border-default pb-3">
              <span
                v-if="logoDataUrl"
                class="inline-flex items-center rounded-md px-1.5 py-1.5 sm:px-2.5"
                :class="{ 'dark:bg-white': !logoDarkViewSrc }"
                data-testid="branding-preview-logo"
              >
                <UColorModeImage
                  v-if="logoDarkViewSrc"
                  :light="logoLightSrc"
                  :dark="logoDarkViewSrc"
                  alt=""
                  class="h-10 w-auto max-w-48 object-contain object-left"
                  @error="onDerivedLogoError"
                />
                <img
                  v-else
                  :src="logoLightSrc"
                  alt=""
                  class="h-10 w-auto max-w-48 object-contain object-left"
                  @error="onDerivedLogoError"
                >
              </span>
              <MunicipalityBrand v-else />
            </div>
            <p class="text-base font-semibold text-highlighted">
              {{ t('admin.settings.branding.previewTitle') }}
            </p>
            <UFormField :label="t('admin.settings.branding.previewFirstName')">
              <UInput
                model-value=""
                class="w-full"
                tabindex="-1"
              />
            </UFormField>
            <UCheckbox
              :model-value="true"
              :label="t('admin.settings.branding.previewConsent')"
              tabindex="-1"
            />
            <UButton
              tabindex="-1"
            >
              {{ t('admin.settings.branding.previewSubmit') }}
            </UButton>
          </div>
        </AppCard>
      </div>
    </div>
  </AppPageLayout>
</template>
