<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui';
import { inject, type AriaAttributes } from 'vue';
import { useOrganisationChoices } from '../../composables/useOrganisationChoices';
import { OPEN_DASHBOARD_WORKSPACE_SWITCHER } from '../../utils/dashboard-workspace-switcher';

const props = defineProps<{
    title: string
    description?: string
    officePath?: string | null
    additionalAction?: ButtonProps
}>();

const { t } = useI18n();
const { organisations } = useOrganisationChoices();
const openWorkspaceSwitcher = inject(OPEN_DASHBOARD_WORKSPACE_SWITCHER, null);
const actions = computed<ButtonProps[]>(() => {
    const items: (ButtonProps & Pick<AriaAttributes, 'aria-haspopup'>)[] = [];
    if (props.officePath) {
        items.push({
            label: t('admin.officeWorkspace.goToOffice'),
            color: 'neutral',
            variant: 'outline',
            to: props.officePath
        });
    } else if (openWorkspaceSwitcher && organisations.value.length) {
        items.push({
            'label': t('admin.officeWorkspace.choose'),
            'color': 'neutral',
            'variant': 'outline',
            'aria-haspopup': 'dialog',
            'onClick': (event: MouseEvent) => {
                if (event.currentTarget instanceof HTMLElement) openWorkspaceSwitcher(event.currentTarget);
            }
        });
    }
    if (props.additionalAction) items.push(props.additionalAction);
    return items;
});
</script>

<template>
  <UAlert
    icon="i-lucide-building-2"
    :title="title"
    :description="description"
    :actions="actions"
  />
</template>
