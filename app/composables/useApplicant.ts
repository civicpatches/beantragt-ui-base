import type { ErasurePreview, ErasureSummary } from '~/utils/citizen-erasure';

export interface ApplicantProfileData {
    /** Drupal applicant id; names the profile for a consent withdrawal. */
    id?: number
    /** Organisation or jurisdiction the profile belongs to. */
    scopeLabel?: string
    email: string
    fullName?: string
    phone?: string
    address?: string
    street?: string
    postalCode?: string
    city?: string
    createdAt?: string
    /** Latest contact-data consent; Drupal applicant field_consent_*. */
    consentAt?: string | null
    consentTextVersion?: string | null
    consentScopeLabel?: string | null
    /** Latest bank-details consent; Drupal applicant field_bank_consent_*. */
    bankConsentAt?: string | null
    bankConsentTextVersion?: string | null
    bankConsentScopeLabel?: string | null
    /** Latest withdrawal of the contact consent under "Meine Daten". */
    consentWithdrawnAt?: string | null
    /** Latest withdrawal of the bank consent under "Meine Daten". */
    bankConsentWithdrawnAt?: string | null
    /** Identity values a sign-in (for example BundID) confirmed. */
    loginConfirmed?: ApplicantLoginConfirmation
}

export type ApplicantConsentKind = 'contact' | 'bank';

export interface ApplicantLoginConfirmation {
    provider: string
    providerLabel: string
    at?: string
    fields: Array<'email' | 'fullName' | 'firstName' | 'lastName' | 'birthdate'>
}

/**
 * Citizen-editable profile fields; consent provenance is read-only.
 */
export type ApplicantProfileUpdate = Pick<ApplicantProfileData, 'fullName' | 'phone' | 'address' | 'street' | 'postalCode' | 'city'>;

export interface ApplicantMyData {
    /** Primary profile (most recently changed); the edit form works on it. */
    profile: ApplicantProfileData | null
    /** Every own profile, one per Stelle, for consents and withdrawals. */
    profiles?: ApplicantProfileData[]
    applicationCount: number
    lastActivity?: string
}

export function useApplicant() {
    const { resolveApiErrorMessage } = useApiErrorMessage();

    const isLoading = ref(false);
    const loadError = ref<string | null>(null);
    const isDeleting = ref(false);
    const deleteError = ref<string | null>(null);
    const isSaving = ref(false);
    const saveError = ref<string | null>(null);
    const storedData = ref<ApplicantMyData | null>(null);
    /** Profile id and kind of the withdrawal in progress. */
    const isWithdrawing = ref<string | null>(null);
    const withdrawError = ref<string | null>(null);

    function clearSaveError() {
        saveError.value = null;
    }

    /**
     * Loads the profile; a silent reload keeps the page content in place.
     */
    async function loadMyData(options: { silent?: boolean } = {}) {
        isLoading.value = !options.silent;
        loadError.value = null;

        try {
            storedData.value = await $fetch<ApplicantMyData>('/api/applicant/my-data');
        } catch (e: unknown) {
            loadError.value = resolveApiErrorMessage(e);
            storedData.value = {
                profile: null,
                profiles: [],
                applicationCount: 0
            };
        } finally {
            isLoading.value = false;
        }
    }

    const isLoadingDeletePreview = ref(false);
    const deletePreviewError = ref<string | null>(null);
    const deletePreview = ref<ErasurePreview | null>(null);

    /**
     * Loads what "Alle meine Daten löschen" deletes and what stays.
     */
    async function loadDeletePreview() {
        isLoadingDeletePreview.value = true;
        deletePreviewError.value = null;

        try {
            deletePreview.value = await $fetch<ErasurePreview>('/api/applicant/delete-preview');
            return deletePreview.value;
        } catch (e: unknown) {
            deletePreview.value = null;
            deletePreviewError.value = resolveApiErrorMessage(e, 'citizen.myData.erasure.previewError');
            throw e;
        } finally {
            isLoadingDeletePreview.value = false;
        }
    }

    /**
     * Deletes the account data; returns what was deleted and what stays.
     */
    async function deleteMyData(): Promise<ErasureSummary> {
        isDeleting.value = true;
        deleteError.value = null;

        try {
            return await $fetch<ErasureSummary>('/api/applicant/delete-my-data', {
                method: 'DELETE'
            });
        } catch (e: unknown) {
            deleteError.value = resolveApiErrorMessage(e);
            throw e;
        } finally {
            isDeleting.value = false;
        }
    }

    async function updateMyData(data: ApplicantProfileUpdate) {
        isSaving.value = true;
        saveError.value = null;

        try {
            // Name the edited profile: an account keeps one profile per
            // Stelle, and Drupal edits only the profile it is told to.
            const profileId = storedData.value?.profile?.id;
            const response = await $fetch<{ data: ApplicantProfileData }>('/api/applicant/my-data', {
                method: 'PATCH',
                body: profileId ? { id: profileId, data } : { data }
            });
            storedData.value = {
                ...(storedData.value || { applicationCount: 0 }),
                profile: response.data
            };
            return response.data;
        } catch (e: unknown) {
            saveError.value = resolveApiErrorMessage(e, 'citizen.myData.saveError');
            throw e;
        } finally {
            isSaving.value = false;
        }
    }

    /**
     * Withdraws one consent on one own profile and reloads from Drupal.
     */
    async function withdrawConsent(profileId: number, kind: ApplicantConsentKind) {
        isWithdrawing.value = `${profileId}:${kind}`;
        withdrawError.value = null;

        try {
            await $fetch(`/api/applicant/profiles/${profileId}/consent/${kind}/withdraw`, { method: 'POST' });
            await loadMyData({ silent: true });
        } catch (e: unknown) {
            withdrawError.value = resolveApiErrorMessage(e, 'citizen.myData.consentWithdrawError');
            throw e;
        } finally {
            isWithdrawing.value = null;
        }
    }

    return {
        isLoading,
        loadError,
        isDeleting,
        deleteError,
        isSaving,
        saveError,
        clearSaveError,
        storedData,
        loadMyData,
        updateMyData,
        deleteMyData,
        isLoadingDeletePreview,
        deletePreviewError,
        deletePreview,
        loadDeletePreview,
        isWithdrawing,
        withdrawError,
        withdrawConsent
    };
}
