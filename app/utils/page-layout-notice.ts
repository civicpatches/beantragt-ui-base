import type { Component, InjectionKey } from 'vue';

/**
 * A notice a layout hands to every `AppPageLayout` below it. The page frame
 * renders it first in its content, before the page's own content (the place
 * of the access notice). Without a provider nothing is rendered:
 * the citizen build and public pages have none.
 */
export const PAGE_LAYOUT_NOTICE: InjectionKey<Component> = Symbol('page-layout-notice');
