import type { IntegrationIssue, MappingRule, MappingRules, MappingOccurrence, SourceField, TargetPath } from '~/types/integrations';

export function isMappingLeaf(target: TargetPath): boolean {
    const types = Array.isArray(target.type) ? target.type : [target.type];
    return target.pointer !== '' && !types.includes('object') && !types.includes('array');
}

export function targetGroup(pointer: string): string {
    return pointer ? `/${pointer.split('/')[1]}` : '';
}

export function indexMappingRules(rules: MappingRule[]): Map<string, MappingRule> {
    return new Map(rules.map(rule => [rule.target, rule]));
}

/** A populated optional container enables its immediate locally required children. */
export function requiredMappingTargets(targets: TargetPath[], rules: MappingRule[], occurrences: MappingOccurrence[] = []): Set<string> {
    const populated = new Set<string>();
    for (const rule of rules) {
        const segments = rule.target.split('/');
        for (let length = 2; length < segments.length; length++) {
            populated.add(segments.slice(0, length).join('/'));
        }
    }
    for (const occurrence of occurrences) {
        const item = `${occurrence.target}/*`;
        const segments = item.split('/');
        for (let length = 2; length <= segments.length; length++) {
            populated.add(segments.slice(0, length).join('/'));
        }
    }
    const required = new Set(targets.filter(target => target.required).map(target => target.pointer));
    for (const target of [...targets].sort((a, b) => a.pointer.length - b.pointer.length)) {
        const parent = target.pointer.slice(0, target.pointer.lastIndexOf('/'));
        if (target.local_required && (populated.has(parent) || required.has(parent))) required.add(target.pointer);
    }
    return new Set(targets.filter(target => isMappingLeaf(target) && required.has(target.pointer)).map(target => target.pointer));
}

export function mappingCoverage(targets: TargetPath[], rules: MappingRule[], occurrences: MappingOccurrence[] = []) {
    const required = requiredMappingTargets(targets, rules, occurrences);
    const mapped = indexMappingRules(rules);
    return { total: required.size, covered: [...required].filter(pointer => mapped.has(pointer)).length };
}

export function valueMapCoverage(field: SourceField | undefined, rule: MappingRule | undefined, target: TargetPath) {
    const options = field?.options ?? [];
    const covered = options.filter(option => rule?.valueMap
      && Object.hasOwn(rule.valueMap, option.value)
      && (!target.enum || target.enum.some(code => code === rule.valueMap?.[option.value]))).length;
    return { total: options.length, covered, complete: options.length > 0 && covered === options.length && Object.keys(rule?.valueMap ?? {}).every(key => options.some(option => option.value === key)) };
}

export function missingOccurrences(target: TargetPath, targets: TargetPath[], rules: MappingRules): TargetPath[] {
    const declared = new Set((rules.occurrences ?? []).map(occurrence => occurrence.target));
    return targets.filter(candidate => (candidate.type === 'array' || (Array.isArray(candidate.type) && candidate.type.includes('array')))
      && target.pointer.startsWith(`${candidate.pointer}/*`)
      && !declared.has(candidate.pointer));
}

export function setSingleOccurrence(rules: MappingRules, pointer: string, enabled: boolean): MappingRules {
    const occurrences = (rules.occurrences ?? []).filter(occurrence => occurrence.target !== pointer);
    if (enabled) occurrences.push({ target: pointer, mode: 'single' });
    const { occurrences: _previous, ...rest } = rules;
    return occurrences.length ? { ...rest, occurrences } : rest;
}

/** Concrete payload indices are normalized to catalog item templates. Unknown targets attach to their group. */
export function mappingErrorsByPointer(errors: IntegrationIssue[], targets: TargetPath[]): Map<string, IntegrationIssue[]> {
    const known = new Set(targets.map(target => target.pointer));
    const result = new Map<string, IntegrationIssue[]>();
    for (const error of errors) {
        const pointer = (error.pointer ?? '').replace(/\/\d+(?=\/|$)/g, '/*');
        const key = known.has(pointer) ? pointer : targetGroup(pointer);
        result.set(key, [...(result.get(key) ?? []), error]);
    }
    return result;
}

export function mappingRuleChanged(rule: MappingRule | undefined, baseline: MappingRule | undefined): boolean {
    if (rule?.source !== baseline?.source) return true;
    const entries = (value: MappingRule | undefined) => Object.entries(value?.valueMap ?? {}).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(entries(rule)) !== JSON.stringify(entries(baseline));
}

export function mappingFieldId(pointer: string): string {
    return `mapping-${encodeURIComponent(pointer).replace(/%/g, '_')}`;
}

/** Stable catalog metadata, calculated only when the catalog changes. */
export function mappingCatalog(targets: TargetPath[]) {
    const byPointer = new Map(targets.map(target => [target.pointer, target]));
    const label = (target: TargetPath): string => target.title || byPointer.get(`${target.pointer}/*`)?.title || target.group_titles.at(-1) || target.pointer;
    const entries = new Map(targets.map((target) => {
        const segments = target.pointer.split('/');
        const ancestors = segments.map((_, index) => byPointer.get(segments.slice(0, index + 1).join('/'))).filter((item): item is TargetPath => !!item);
        const groupAncestors = ancestors.filter(item => /^G[0-9]/.test(item.pointer.split('/').at(-1) || ''));
        const group = groupAncestors.at(-1)?.pointer || targetGroup(target.pointer);
        const arrays = ancestors.filter(item => item.pointer !== target.pointer && (Array.isArray(item.type) ? item.type.includes('array') : item.type === 'array'));
        return [target.pointer, { target, group, arrays, label: label(target), unsupported: [...new Set(ancestors.flatMap(item => item.unsupported))] }] as const;
    }));
    return { byPointer, entries, label };
}

/** Object key order is irrelevant, while persisted list order remains intact. */
export function mappingRulesEqual(left: MappingRules, right: MappingRules): boolean {
    const canonical = (rules: MappingRules) => JSON.stringify({
        rules: rules.rules.map(rule => ({ source: rule.source, target: rule.target, valueMap: Object.entries(rule.valueMap ?? {}).sort(([a], [b]) => a.localeCompare(b)) })),
        occurrences: rules.occurrences ?? []
    });
    return canonical(left) === canonical(right);
}
