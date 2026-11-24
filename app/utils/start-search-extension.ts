import type { Component, InjectionKey, Ref } from 'vue';
import type { PublicJurisdictionConfig } from './public-jurisdiction-config';

interface StartSearchContext {
    jurisdiction: Readonly<Ref<string | undefined>>
    organisation: Readonly<Ref<string | undefined>>
    config: Readonly<Ref<PublicJurisdictionConfig | null>>
    configPending: Readonly<Ref<boolean>>
    totalForms: Readonly<Ref<number>>
}

export type StartSearchProvider = (context: StartSearchContext) => {
    component: Component
    available: Readonly<Ref<boolean>>
    pending: Readonly<Ref<boolean>>
    announcement: Readonly<Ref<string>>
    heading: Readonly<Ref<string>>
    subtitle: Readonly<Ref<string>>
    fallbackNotice: Readonly<Ref<string>>
    showCatalogFilter: Readonly<Ref<boolean>>
    engageCatalogSearch: () => void
    fallBackToCatalog: () => void
};

export const startSearchExtensionKey: InjectionKey<StartSearchProvider> = Symbol('startSearchExtension');
