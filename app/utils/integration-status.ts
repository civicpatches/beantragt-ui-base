import { DRAFT_ICON } from './action-icons';

// Colour and icon tell the integration states apart (data, not look); the label says it in words. The badge's look
// comes from the theme: the default variant of the installation's theme (`badge.defaultVariants`, today
// app/utils/theme/current.ts), so no entry sets a variant. `draft` is neutral like `disabled`, `inactive` and
// `retired` and told apart by its sign (`DRAFT_ICON`, the dashed circle) and its label.
export const INTEGRATION_STATUS = {
    integrity_failed: { color: 'error', icon: 'i-lucide-shield-alert' },
    draft: { color: 'neutral', icon: DRAFT_ICON },
    active: { color: 'success', icon: 'i-lucide-circle-check' },
    disabled: { color: 'neutral', icon: 'i-lucide-circle-pause' },
    inactive: { color: 'neutral', icon: 'i-lucide-circle-pause' },
    retired: { color: 'neutral', icon: 'i-lucide-archive' },
    blocked: { color: 'error', icon: 'i-lucide-octagon-alert' },
    valid: { color: 'info', icon: 'i-lucide-clipboard-check' },
    invalid: { color: 'error', icon: 'i-lucide-clipboard-x' },
    awaiting_approval: { color: 'warning', icon: 'i-lucide-hand' },
    queued: { color: 'info', icon: 'i-lucide-clock' },
    processing: { color: 'info', icon: 'i-lucide-loader' },
    accepted: { color: 'success', icon: 'i-lucide-check' },
    failed: { color: 'error', icon: 'i-lucide-circle-x' },
    validation_failed: { color: 'error', icon: 'i-lucide-file-x' },
    mock: { color: 'neutral', icon: 'i-lucide-flask-conical' },
    stale: { color: 'neutral', icon: 'i-lucide-clock' },
    unchecked: { color: 'neutral', icon: 'i-lucide-clipboard' }
} as const;
