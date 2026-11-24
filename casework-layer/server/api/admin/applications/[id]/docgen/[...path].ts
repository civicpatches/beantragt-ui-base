import { handleDocgenCase } from '../../../../../utils/admin-docgen';

/** Draft, revise, preview and release decision documents of one application. */
export default defineEventHandler((event) => {
    let path: string;
    try {
        path = decodeURIComponent(getRouterParam(event, 'path') || '');
    } catch {
        path = '/invalid/%';
    }
    return handleDocgenCase(event, path);
});
