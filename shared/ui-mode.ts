export type UiMode = 'citizen' | 'all';
export type UiAccess = 'open' | 'closed';
export type UiOrigin = 'base' | 'casework' | 'pro' | 'nuxt';

export interface UiRoute {
    path: string
    origin: UiOrigin
    access: UiAccess
}

export interface UiHandler extends UiRoute {
    method?: string
}

export interface UiPage extends UiRoute {
    name?: string
    redirect?: unknown
}

export const STAFF_HOST_ERROR = 'errors.auth.staffOnCitizenHost';
