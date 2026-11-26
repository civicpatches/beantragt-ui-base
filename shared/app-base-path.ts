export function appBasePath(baseURL: string, path: string): string {
    return baseURL.replace(/\/$/u, '') + path;
}
