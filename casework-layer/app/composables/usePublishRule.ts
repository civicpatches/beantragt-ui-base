import type { Ref } from 'vue';
import { useOrganisationChoices } from './useOrganisationChoices';

/**
 * The interface's publish rule, shared by every way
 * to publish (form page, guided setup review, form editor): in a municipality
 * workspace whose municipality has organisations, a form without a
 * responsible organisation is not published from here, because its case
 * workers could not process the applications.
 *
 * The server route does not check this (backend follow-up on the owner's
 * list), so the texts say "hier" and claim nothing beyond the interface.
 *
 * `organisationId` is the form's own organisation: on the form page and in
 * the editor from `relationships.field_organisation`, in the setup from the
 * workspace (the setup runs only in the form's own workspace). Without one,
 * an organisation workspace stands in: it opens only its own forms
 * (`applyAdminJurisdictionFilter`).
 */
export function usePublishRule(organisationId: Ref<string | null>) {
    const { workspaces, currentWorkspace } = useWorkspaceContext();
    const { organisations } = useOrganisationChoices();
    const { t } = useI18n();

    const effectiveOrganisationId = computed(() => organisationId.value
      ?? (currentWorkspace.value?.type === 'organisation' ? currentWorkspace.value.id : null));

    const organisationMissing = computed(() => !effectiveOrganisationId.value
      && currentWorkspace.value?.type === 'jurisdiction'
      && organisations.value.length > 0);

    /** Who receives the applications, as the confirmation says it. */
    const receiverText = computed(() => {
        const id = effectiveOrganisationId.value;
        if (!id) return t('admin.setup.review.publishConfirmMunicipality', { name: currentWorkspace.value?.label ?? '' });
        const name = workspaces.value.find(workspace => workspace.type === 'organisation' && workspace.id === id)?.label
          ?? (currentWorkspace.value?.type === 'organisation' && currentWorkspace.value.id === id ? currentWorkspace.value.label : null)
          ?? t('admin.forms.organisationSetting.hidden');
        return t('admin.setup.review.publishConfirmOrganisation', { name });
    });

    return { organisationMissing, receiverText };
}
