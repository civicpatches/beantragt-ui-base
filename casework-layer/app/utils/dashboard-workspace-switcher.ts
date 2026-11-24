import type { InjectionKey } from 'vue';

export const OPEN_DASHBOARD_WORKSPACE_SWITCHER: InjectionKey<(opener: HTMLElement) => void> = Symbol('open-dashboard-workspace-switcher');
