import { z } from 'zod';

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u);
const fact = z.discriminatedUnion('type', [
    z.object({ key, type: z.literal('number'), value: z.number().nullable() }),
    z.object({ key, type: z.literal('integer'), value: z.number().int().nullable() }),
    z.object({ key, type: z.literal('boolean'), value: z.boolean().nullable() })
]);
const comparison = z.object({
    key,
    fieldId: z.string().min(1).max(128),
    state: z.enum(['match', 'mismatch', 'no_value', 'no_answer', 'answer_unavailable', 'rule_unavailable']),
    extracted: z.number().nullable(),
    reported: z.number().nullable()
});

/** The only online staff analysis fields allowed through the case detail proxy. */
export const staffAttachmentAnalysisSchema = z.object({
    state: z.enum(['not_configured', 'not_requested', 'pending', 'complete', 'needs_review', 'unavailable']),
    reason: z.enum([
        'queued', 'processing', 'previous_run', 'result_not_received', 'file_unavailable', 'source_unavailable',
        'configuration_unavailable', 'run_failed', 'values_unavailable', 'check_comparisons', 'incomplete_evidence',
        'review_evidence'
    ]).nullable(),
    canRun: z.boolean(),
    pollUntil: z.number().int().positive().nullable(),
    checks: z.object({ party: z.literal('not_configured'), validity: z.literal('not_configured') }),
    facts: z.array(fact).max(20),
    comparisons: z.array(comparison).max(20)
});

export type StaffAttachmentAnalysis = z.infer<typeof staffAttachmentAnalysisSchema>;
