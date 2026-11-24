import { readFileSync, statSync } from 'node:fs';

const MAX_RUNTIME_SECRET_BYTES = 64 * 1024;

function firstConfiguredEnvironmentValue(names: readonly string[]): string {
    for (const name of names) {
        const value = process.env[name]?.trim();
        if (value) return value;
    }
    return '';
}

export function readRuntimeSecret(options: {
    valueNames: readonly string[]
    fileNames: readonly string[]
}): string {
    const directValue = firstConfiguredEnvironmentValue(options.valueNames);
    if (directValue) return directValue;

    const filePath = firstConfiguredEnvironmentValue(options.fileNames);
    if (!filePath) return '';

    try {
        const stat = statSync(filePath);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_RUNTIME_SECRET_BYTES) {
            return '';
        }
        return readFileSync(filePath, {
            encoding: 'utf8',
            flag: 'r'
        }).trim();
    } catch {
        return '';
    }
}
