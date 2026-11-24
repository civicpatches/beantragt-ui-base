<script setup lang="ts">
import { formatDate } from '~/composables/useFormatters';
import {
    erasureRetentionDuration,
    erasureRetentionKind,
    erasureSharedContactEmail,
    erasureStelleLabel,
    type ErasureKeptApplication
} from '~/utils/citizen-erasure';

/**
 * Lists what "Alle meine Daten löschen" deletes and what stays with the
 * Stelle: before the confirmation (preview) and afterwards (summary).
 */
const props = withDefaults(defineProps<{
    mode: 'preview' | 'summary'
    account: boolean
    accountEmail?: string
    /** Stelle labels of the deleted profiles; empty when none exists. */
    profileLabels: string[]
    profileCount: number
    unconfirmedApplications: number
    unconfirmedUploads?: number
    loginLinks: number
    keeps: ErasureKeptApplication[]
    /** Level of the section headings: 4 below a dialog h3, 3 below a page h2. */
    headingLevel?: 3 | 4
}>(), {
    accountEmail: undefined,
    unconfirmedUploads: 0,
    headingLevel: 4
});

const headingTag = computed(() => `h${props.headingLevel}`);

const { t } = useI18n();

const deleteItems = computed(() => {
    const items: Array<{ key: string, text: string }> = [];
    if (props.account) {
        items.push({
            key: 'account',
            text: props.accountEmail
                ? t('citizen.myData.erasure.deleteAccountWithEmail', { email: props.accountEmail })
                : t('citizen.myData.erasure.deleteAccount')
        });
    }
    if (props.profileLabels.length) {
        props.profileLabels.forEach((label, index) => items.push({
            key: `profile-${index}`,
            text: t('citizen.myData.erasure.deleteProfileAt', { stelle: label })
        }));
    }
    const unlabelled = Math.max(0, props.profileCount - props.profileLabels.length);
    if (unlabelled > 0) {
        items.push({ key: 'profiles', text: t('citizen.myData.erasure.deleteProfiles', { count: unlabelled }) });
    }
    if (props.unconfirmedApplications > 0) {
        items.push({ key: 'unconfirmed', text: t('citizen.myData.erasure.deleteUnconfirmed', { count: props.unconfirmedApplications }) });
    }
    if (props.unconfirmedUploads > 0) {
        items.push({ key: 'uploads', text: t('citizen.myData.erasure.deleteUploads', { count: props.unconfirmedUploads }) });
    }
    if (props.loginLinks > 0) {
        items.push({ key: 'login-links', text: t('citizen.myData.erasure.deleteLoginLinks', { count: props.loginLinks }) });
    }
    items.push({ key: 'drafts', text: t('citizen.myData.erasure.deleteDrafts') });
    return items;
});

function retentionText(application: ErasureKeptApplication): string {
    if (erasureRetentionKind(application) === 'date' && application.retention.deleteAfter) {
        const duration = erasureRetentionDuration(application.retention.days);
        const durationText = t(`citizen.myData.erasure.duration.${duration.unit}`, { count: duration.count }, duration.count);
        // The cleanup runs on cron; a date already past means "next run".
        if (Date.parse(application.retention.deleteAfter) <= Date.now()) {
            return t('citizen.myData.erasure.retentionOverdue', { duration: durationText });
        }
        return t('citizen.myData.erasure.retentionDate', {
            date: formatDate(application.retention.deleteAfter),
            duration: durationText
        });
    }
    return t('citizen.myData.erasure.retentionNone');
}

/** The contact address shared by every kept application, if any. */
const sharedContactEmail = computed(() => erasureSharedContactEmail(props.keeps));

function stelleText(application: ErasureKeptApplication): string {
    return erasureStelleLabel(application) || t('citizen.myData.erasure.stelleUnknown');
}

/** One contact line per Stelle, for the Art. 17 hint. */
const stelleContacts = computed(() => {
    const contacts = new Map<string, ErasureKeptApplication['stelle']['contact']>();
    for (const application of props.keeps) {
        const label = erasureStelleLabel(application);
        if (!label || contacts.has(label)) continue;
        contacts.set(label, application.stelle.contact);
    }
    return [...contacts.entries()].map(([label, contact]) => ({ label, contact }));
});
</script>

<template>
  <div
    class="space-y-5"
    data-testid="erasure-overview"
  >
    <section data-testid="erasure-deletes">
      <component
        :is="headingTag"
        class="text-sm font-semibold text-highlighted mb-2"
      >
        {{ mode === 'summary' ? t('citizen.myData.erasure.deletedTitle') : t('citizen.myData.erasure.deletesTitle') }}
      </component>
      <ul class="text-sm text-muted space-y-1">
        <li
          v-for="item in deleteItems"
          :key="item.key"
          class="flex items-start gap-2"
          :data-testid="`erasure-delete-${item.key}`"
        >
          <UIcon
            name="i-lucide-trash-2"
            class="size-4 mt-0.5 shrink-0 text-error"
          />
          <span>{{ item.text }}</span>
        </li>
      </ul>
    </section>

    <section data-testid="erasure-keeps">
      <component
        :is="headingTag"
        class="text-sm font-semibold text-highlighted mb-1"
      >
        {{ t('citizen.myData.erasure.keepsTitle') }}
      </component>
      <p class="text-sm text-muted mb-3">
        {{ t('citizen.myData.erasure.keepsIntro') }}
      </p>
      <p
        v-if="sharedContactEmail"
        class="text-sm text-highlighted mb-3"
        data-testid="erasure-keeps-contact"
      >
        {{ t('citizen.myData.erasure.keepsContact', { email: sharedContactEmail }) }}
      </p>
      <p
        v-if="keeps.length === 0"
        class="text-sm text-muted"
        data-testid="erasure-keeps-none"
      >
        {{ t('citizen.myData.erasure.keepsNone') }}
      </p>
      <ul
        v-else
        class="space-y-3"
      >
        <li
          v-for="application in keeps"
          :key="application.id"
          class="rounded-md border border-default p-3"
          :data-testid="`erasure-keep-${application.referenceNumber}`"
        >
          <p
            v-if="application.formTitle"
            class="text-sm font-medium text-highlighted mb-2"
          >
            {{ application.formTitle }}
          </p>
          <dl class="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <dt class="text-muted">
              {{ t('citizen.myData.erasure.referenceNumber') }}
            </dt>
            <dd class="font-medium text-highlighted">
              {{ application.referenceNumber }}
            </dd>
            <dt class="text-muted">
              {{ t('citizen.myData.erasure.stelle') }}
            </dt>
            <dd class="text-highlighted">
              {{ stelleText(application) }}
            </dd>
            <template v-if="application.applicantEmail && !sharedContactEmail">
              <dt class="text-muted">
                {{ t('citizen.myData.erasure.contactEmail') }}
              </dt>
              <dd
                class="text-highlighted break-all"
                data-testid="erasure-keep-contact"
              >
                {{ application.applicantEmail }}
              </dd>
            </template>
            <template v-if="application.submittedAt">
              <dt class="text-muted">
                {{ t('citizen.myData.erasure.submittedAt') }}
              </dt>
              <dd class="text-highlighted">
                {{ formatDate(application.submittedAt) }}
              </dd>
            </template>
            <dt class="text-muted">
              {{ t('citizen.myData.erasure.retention') }}
            </dt>
            <dd
              class="text-highlighted"
              data-testid="erasure-keep-retention"
            >
              {{ retentionText(application) }}
            </dd>
          </dl>
        </li>
      </ul>
    </section>

    <section
      v-if="keeps.length > 0"
      class="rounded-md bg-muted p-3"
      data-testid="erasure-art17"
    >
      <component
        :is="headingTag"
        class="text-sm font-semibold text-highlighted mb-1"
      >
        {{ t('citizen.myData.erasure.art17Title') }}
      </component>
      <p class="text-sm text-muted mb-2">
        {{ t('citizen.myData.erasure.art17Text') }}
      </p>
      <ul class="text-sm space-y-1">
        <li
          v-for="entry in stelleContacts"
          :key="entry.label"
          :data-testid="`erasure-contact-${entry.label}`"
        >
          <span class="font-medium text-highlighted">{{ entry.label }}:</span>
          <template v-if="entry.contact.email || entry.contact.phone || entry.contact.website">
            <a
              v-if="entry.contact.email"
              :href="`mailto:${entry.contact.email}`"
              class="ml-1 text-(--ui-primary) hover:underline"
            >{{ entry.contact.email }}</a>
            <span
              v-if="entry.contact.phone"
              class="ml-1 text-default"
            >{{ entry.contact.phone }}</span>
            <a
              v-if="entry.contact.website"
              :href="entry.contact.website"
              target="_blank"
              rel="noopener noreferrer"
              class="ml-1 text-(--ui-primary) hover:underline"
            >{{ entry.contact.website }}</a>
          </template>
          <span
            v-else
            class="ml-1 text-muted"
          >{{ t('citizen.myData.erasure.art17NoContact') }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
