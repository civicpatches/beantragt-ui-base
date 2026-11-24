import type { DropdownMenuItem } from '@nuxt/ui';
import type { InjectionKey, Ref } from 'vue';
import type { PublicFormPathInput } from './public-form-path';

interface AccountMenuContext {
    workspace: Readonly<Ref<PublicFormPathInput>>
    applicationsPath: Readonly<Ref<string>>
    loading: Readonly<Ref<boolean>>
    withSessionEnd: (action: () => Promise<boolean>) => Promise<void>
}

export const accountMenuExtensionKey: InjectionKey<(context: AccountMenuContext) => {
    groups: Readonly<Ref<DropdownMenuItem[][]>>
    busy: Readonly<Ref<boolean>>
}> = Symbol('accountMenuExtension');

export const loginCodeHintKey: InjectionKey<string> = Symbol('loginCodeHint');
