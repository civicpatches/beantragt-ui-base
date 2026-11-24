export function parseUiMode(value) {
    if (value === undefined || value === 'citizen') return 'citizen';
    if (value === 'all') return 'all';
    throw new Error('BEANTRAGT_UI_MODE must be citizen or all.');
}
