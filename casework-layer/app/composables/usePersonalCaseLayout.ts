import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { staffFetch } from './api/useStaffSessionFetch';
import { copyCaseLayout, isCaseLayout, resolveCaseLayout, type CaseLayout } from '../utils/case-layout';

export interface CaseLayoutResponse {
    layout: CaseLayout | null
    workspaceDefault: CaseLayout | null
    writable: boolean
    workspaceDefaultWritable: boolean
}

/** Account and workspace changes invalidate outstanding reads and writes. */
export function usePersonalCaseLayout(context: Readonly<Ref<string>>, query: Readonly<Ref<Record<string, string>>>) {
    const personal = ref<CaseLayout | null>(null);
    const workspaceDefault = ref<CaseLayout | null>(null);
    const loading = ref(false);
    const saving = ref(false);
    const writable = ref(false);
    const workspaceDefaultWritable = ref(false);
    const error = ref<'load' | 'save' | null>(null);
    let epoch = 0;
    const layout = computed(() => resolveCaseLayout(personal.value, workspaceDefault.value));
    const baseline = computed(() => resolveCaseLayout(null, workspaceDefault.value));
    function receive(value: CaseLayoutResponse) {
        if (!value || (value.layout !== null && !isCaseLayout(value.layout)) || (value.workspaceDefault !== null && !isCaseLayout(value.workspaceDefault))) throw new Error('Invalid case layout');
        personal.value = value.layout ? copyCaseLayout(value.layout) : null;
        workspaceDefault.value = value.workspaceDefault ? copyCaseLayout(value.workspaceDefault) : null;
        writable.value = value.writable === true;
        workspaceDefaultWritable.value = value.workspaceDefaultWritable === true;
    }
    async function load() {
        const version = ++epoch;
        personal.value = workspaceDefault.value = null;
        writable.value = workspaceDefaultWritable.value = false;
        error.value = null;
        saving.value = false;
        loading.value = Boolean(context.value);
        if (!context.value) return;
        try {
            const result = await staffFetch<CaseLayoutResponse>('/api/admin/case-layout', { query: { ...query.value } });
            if (version === epoch) receive(result);
        } catch {
            if (version === epoch) error.value = 'load';
        } finally {
            if (version === epoch) loading.value = false;
        }
    }
    async function save(next: CaseLayout | null, workspace = false) {
        if (!context.value || loading.value || saving.value || !writable.value || (workspace && !workspaceDefaultWritable.value) || (next !== null && !isCaseLayout(next))) return false;
        const version = epoch;
        saving.value = true;
        error.value = null;
        try {
            const result = await staffFetch<CaseLayoutResponse>(`/api/admin/case-layout${workspace ? '/workspace' : ''}`, {
                method: 'PATCH', query: { ...query.value }, body: { layout: next }
            });
            if (version !== epoch) return false;
            receive(result);
            return true;
        } catch {
            if (version === epoch) error.value = 'save';
            return false;
        } finally {
            if (version === epoch) saving.value = false;
        }
    }
    watch(context, load, { immediate: true, flush: 'sync' });
    onBeforeUnmount(() => {
        epoch++;
    });
    return { layout, baseline, loading, saving, writable, workspaceDefaultWritable, error, load, save };
}
