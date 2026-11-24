import { ref } from 'vue';
import type { CaseDetailPanelContext } from '~~/casework-layer/app/utils/case-detail-context';

/** Shared only by the independently registered panels of this mounted case. */
function createState() {
    return {
        nachreichungVersion: ref(0),
        deliveryVersion: ref(0),
        docgenPanel: ref<{ reload: () => Promise<void> } | null>(null),
        requestWay: ref<'available' | 'missing' | null>(null),
        transfersPanel: ref<{ reload: () => Promise<void>, afterDataEdit: (ids: string[], changed?: boolean) => Promise<void> } | null>(null)
    };
}
const states = new WeakMap<CaseDetailPanelContext, ReturnType<typeof createState>>();
export function useCasePanelState(context: CaseDetailPanelContext) {
    let state = states.get(context);
    if (!state) {
        state = createState();
        states.set(context, state);
    }
    return state;
}
