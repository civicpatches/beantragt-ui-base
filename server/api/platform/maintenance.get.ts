import { proxyMaintenanceStatus } from '../../utils/maintenance-proxy';

/** Public maintenance status proxy. It remains reachable while Core is closed. */
export default defineEventHandler(async (event) => {
    setHeader(event, 'Cache-Control', 'no-store');
    return proxyMaintenanceStatus(event);
});
