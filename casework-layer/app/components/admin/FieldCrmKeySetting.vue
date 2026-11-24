<script setup lang="ts">
import type { FormField, FormSchema } from '~/types/form';
import { PROFILE_PROPERTY_BY_PUBLIC_CRM_KEY, profilePropertyForPrefillField } from '~/utils/profile-prefill';
import { isSensitiveFlag } from '~/utils/form-schema';
import { fieldName } from '../../utils/field-name';

/**
 * "Profil" of a field: which datum of the applicant's profile it feeds
 * and is prefilled from. The keys are the public prefill list the backend
 * knows (`PROFILE_PROPERTY_BY_PUBLIC_CRM_KEY`, mirror of Drupal's
 * PublicFormApiController::PUBLIC_PROFILE_CRM_FIELD_TYPES), limited to the
 * keys this field's type may carry. A person key may stand on one field per
 * form; keys used elsewhere are shown disabled with the field that has them,
 * so the rule is told before anything is saved. A stored key outside the
 * list (bank data, tax ID, company keys) is shown as stored and not offered.
 */
const props = defineProps<{
    schema: FormSchema
    field: FormField
    /** Inside the inspector's group "Angabe im Profil" the group title names it; the label stays for screen readers. */
    hideLabel?: boolean
}>();

const emit = defineEmits<{
    'update:crmKey': [key: string | undefined]
}>();

const { t } = useI18n();

const NO_KEY = '__none__';
const PUBLIC_KEYS = Object.keys(PROFILE_PROPERTY_BY_PUBLIC_CRM_KEY);

const storedKey = computed(() => typeof props.field.crm_key === 'string' ? props.field.crm_key.trim() : '');
const selectId = computed(() => `field-crm-key-${props.field.id}`);

/** Other fields of the form by the key they carry. */
const keyOwners = computed(() => {
    const owners = new Map<string, string>();
    for (const section of props.schema.sections) {
        for (const other of section.fields) {
            if (other.id === props.field.id || typeof other.crm_key !== 'string') continue;
            const key = other.crm_key.trim();
            // A field without a label is named as the card names it, never by its key.
            if (key && !owners.has(key)) owners.set(key, fieldName(other, t('admin.fieldInspector.untitledField')));
        }
    }
    return owners;
});

/** Keys this field's type may carry: the prefill rule with a fitting classification. */
function fitsType(key: string): boolean {
    return profilePropertyForPrefillField({ type: props.field.type, crm_key: key, privacy: { kind: 'contact' } }) !== null;
}

const items = computed(() => {
    const offered = PUBLIC_KEYS.filter(fitsType).map((key) => {
        const owner = keyOwners.value.get(key);
        return {
            label: t(`admin.fieldInspector.crmKey.keys.${key}`),
            value: key,
            ...(owner && key !== storedKey.value
                ? { disabled: true, description: t('admin.fieldInspector.crmKey.usedBy', { field: owner }) }
                : {})
        };
    });
    const stored = storedKey.value && !offered.some(item => item.value === storedKey.value)
        ? [{ label: t('admin.fieldInspector.crmKey.storedOther', { key: storedKey.value }), value: storedKey.value }]
        : [];
    return [{ label: t('admin.fieldInspector.crmKey.none'), value: NO_KEY }, ...offered, ...stored];
});

/** The stored key also stands on another field: publishing is refused until one is left. */
const duplicateOwner = computed(() => storedKey.value.startsWith('person.') ? keyOwners.value.get(storedKey.value) ?? '' : '');

/** Why a stored key does not prefill: the classification or the protection mark. */
const prefillNote = computed(() => {
    if (!storedKey.value || !Object.hasOwn(PROFILE_PROPERTY_BY_PUBLIC_CRM_KEY, storedKey.value)) {
        return storedKey.value ? t('admin.fieldInspector.crmKey.notPrefilledKey') : '';
    }
    if (!fitsType(storedKey.value)) return t('admin.fieldInspector.crmKey.notPrefilledType');
    if (profilePropertyForPrefillField(props.field)) return '';
    return isSensitiveFlag(props.field.sensitive)
        ? t('admin.fieldInspector.crmKey.notPrefilledProtected')
        : t('admin.fieldInspector.crmKey.notPrefilledPrivacy');
});

function onChange(value: unknown) {
    if (typeof value !== 'string') return;
    const next = value === NO_KEY ? undefined : value;
    if ((next ?? '') === storedKey.value) return;
    emit('update:crmKey', next);
}
</script>

<template>
  <div
    class="space-y-2"
    data-testid="field-crm-key"
  >
    <UFormField
      :label="t('admin.fieldInspector.crmKey.label')"
      :description="t('admin.fieldInspector.crmKey.help')"
      name="field-crm-key"
    >
      <template
        v-if="hideLabel"
        #label
      >
        <span class="sr-only">{{ t('admin.fieldInspector.crmKey.label') }}</span>
      </template>
      <USelect
        :id="selectId"
        :model-value="storedKey || NO_KEY"
        :items="items"
        class="w-full"
        data-testid="field-crm-key-select"
        @update:model-value="onChange"
      />
    </UFormField>
    <p
      v-if="duplicateOwner"
      class="text-sm text-(--ui-color-warning-700) dark:text-(--ui-warning)"
      role="status"
      data-testid="field-crm-key-duplicate"
    >
      {{ t('admin.fieldInspector.crmKey.duplicate', { field: duplicateOwner }) }}
    </p>
    <p
      v-if="prefillNote"
      class="text-sm text-(--ui-text-muted)"
      data-testid="field-crm-key-note"
    >
      {{ prefillNote }}
    </p>
  </div>
</template>
