/**
 * beantragt.ai case-work layer (Layer 2b, "Sachbearbeitung").
 *
 * Provides applications, forms, FIM, staff invitations, export and basic settings.
 * Extends the base app. The layer check and the Vite and Nitro guards verify
 * that the casework build uses only the base app and this layer.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const layerDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
    components: {
        dirs: [
            {
                path: resolve(layerDir, 'app/components'),
                pathPrefix: true,
                // Register casework components ahead of the base app’s staff stubs.
                priority: 100
            }
        ]
    },

    imports: {
        dirs: [
            resolve(layerDir, 'app/composables'),
            // `useStaffSessionFetch` lives in `composables/api/` and is auto-imported from there today.
            resolve(layerDir, 'app/composables/api')
        ]
    },

    icon: {
        clientBundle: {
            // The open registry entries name their icons in `.ts` files (`utils/casework-extensions.ts`, the open
            // destinations of `utils/function-search.ts`), which the client-bundle scan does not read. Not named:
            // `alarm-clock` and `file-pen`, which no build has bundled so far (they load at run time); adding them
            // would grow the full product's bundle.
            icons: [
                'lucide:inbox', 'lucide:user-round', 'lucide:eye', 'lucide:refresh-cw', 'lucide:history', 'lucide:printer',
                'lucide:trash-2', 'lucide:paperclip', 'lucide:contact', 'lucide:message-circle', 'lucide:user-plus',
                'lucide:calendar', 'lucide:calendar-clock',
                'lucide:book-open', 'lucide:chevrons-up-down', 'lucide:log-out',
                // Sidebar entries opened from Pro (forms, procedures, FIM catalogue, settings).
                'lucide:file-text', 'lucide:folder-tree', 'lucide:database', 'lucide:settings'
            ]
        }
    }
});
