/** Compare explicit ISO-8601 instants, preserving stale-write protection. */
export function sameChangedTimestamp(current: unknown, expected: unknown): boolean {
    const timestamp = (value: unknown): number => {
        if (typeof value !== 'string') return NaN;
        // Never interpret a timezone-less value in the server's local timezone.
        const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.exec(value);
        if (!match) return NaN;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return NaN;
        return Date.parse(value);
    };
    const currentTime = timestamp(current);
    const expectedTime = timestamp(expected);
    return Number.isFinite(currentTime) && Number.isFinite(expectedTime) && currentTime === expectedTime;
}
