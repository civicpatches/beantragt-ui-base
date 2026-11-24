import type { MappingRule } from './integrations';

export interface MappingSourceOption { value: string, label: string, sourceType: string, section: string, hasOptions: boolean, usage: string }
export interface MappingSourceChange { pointer: string, rule: MappingRule | undefined }
