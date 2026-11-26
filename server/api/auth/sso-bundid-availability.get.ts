import { setPrivateNoStore } from '../../utils/request-security';

const HEALTH_TIMEOUT_MS = 2000;
const HEALTH_CACHE_MS = 60_000;
let cachedHealth: { url: string, expiresAt: number, available: Promise<boolean> } | undefined;

async function probeMetadata(value: string): Promise<boolean> {
    const url = URL.parse(value);
    if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return false;

    try {
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
        void response.body?.cancel().catch(() => {});
        return response.ok;
    } catch {
        return false;
    }
}

export default defineEventHandler(async (event) => {
    setPrivateNoStore(event);
    const config = useRuntimeConfig(event);
    if (!config.public.ssoBundidEnabled) return { available: false };
    const url = config.ssoBundidHealthUrl.trim();
    if (!url) return { available: true };

    if (!cachedHealth || cachedHealth.url !== url || cachedHealth.expiresAt <= Date.now()) {
        const entry = { url, expiresAt: Infinity, available: probeMetadata(url) };
        entry.available = entry.available.finally(() => {
            entry.expiresAt = Date.now() + HEALTH_CACHE_MS;
        });
        cachedHealth = entry;
    }
    return { available: await cachedHealth.available };
});
