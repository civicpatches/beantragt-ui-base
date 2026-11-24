#!/usr/bin/env node

/**
 * Translation Coverage Checker
 * Identifies missing translation keys across beantragt UI locales.
 *
 * German (de) is the reference locale. The required key set is the union across
 * all locale files so extra keys in any locale are surfaced as gaps elsewhere.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const LOCALES_DIR = 'i18n/locales';
const REFERENCE_LOCALE = 'de';
const IGNORED_KEYS = new Set(['locale', 'meta']);

function extractKeys(obj, prefix = '') {
    const keys = [];

    for (const [key, value] of Object.entries(obj)) {
        if (IGNORED_KEYS.has(key)) continue;

        const fullKey = prefix ? `${prefix}.${key}` : key;

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            keys.push(...extractKeys(value, fullKey));
        } else {
            keys.push(fullKey);
        }
    }

    return keys.sort();
}

function extractObjectLiteral(content, filePath) {
    const exportIndex = content.indexOf('export default');
    if (exportIndex === -1) {
        throw new Error(`No default export found in ${filePath}`);
    }

    const startIndex = content.indexOf('{', exportIndex);
    const endIndex = content.lastIndexOf('}');

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
        throw new Error(`No locale object found in ${filePath}`);
    }

    return content.slice(startIndex, endIndex + 1);
}

function loadLocale(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const objectContent = extractObjectLiteral(content, filePath);
    const script = new vm.Script(`(${objectContent})`, { filename: filePath });
    const data = script.runInNewContext(Object.create(null), { timeout: 1000 });

    return {
        data,
        keys: extractKeys(data)
    };
}

function discoverLocales(dir) {
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
        .filter(fileName => fileName.endsWith('.ts'))
        .map(fileName => fileName.replace(/\.ts$/, ''))
        .sort();
}

function groupKeysBySection(keys) {
    const sections = {};

    for (const key of keys) {
        const section = key.split('.')[0];
        sections[section] ??= [];
        sections[section].push(key);
    }

    return sections;
}

function checkTranslations(directory = LOCALES_DIR) {
    console.log(`Checking translation coverage in ${directory}...\n`);

    const localeNames = discoverLocales(directory);
    if (localeNames.length === 0) {
        console.error(`No locale files found in ${directory}.`);
        return true;
    }

    if (!localeNames.includes(REFERENCE_LOCALE)) {
        console.error(`Reference locale "${REFERENCE_LOCALE}" is missing in ${directory}.`);
        return true;
    }

    const locales = [];
    let hasIssues = false;

    for (const name of localeNames) {
        const filePath = path.join(directory, `${name}.ts`);

        try {
            locales.push({ name, ...loadLocale(filePath) });
        } catch (error) {
            console.error(`Error loading ${filePath}: ${error.message}`);
            hasIssues = true;
        }
    }

    if (locales.length === 0) {
        console.error('No locale files could be loaded.');
        return true;
    }

    const reference = locales.find(locale => locale.name === REFERENCE_LOCALE);
    if (!reference) {
        console.error(`Reference locale "${REFERENCE_LOCALE}" could not be loaded.`);
        return true;
    }

    const allKeys = new Set(reference.keys);
    for (const locale of locales) {
        for (const key of locale.keys) {
            allKeys.add(key);
        }
    }

    const allKeyList = Array.from(allKeys).sort();

    console.log(`Locales directory: ${directory}`);
    console.log(`Reference locale: ${REFERENCE_LOCALE}`);
    console.log(`Locales: ${localeNames.join(', ')}\n`);
    console.log(`Reference keys: ${reference.keys.length}`);
    console.log(`Union keys: ${allKeyList.length}\n`);

    console.log('Coverage:');
    for (const locale of locales) {
        const missingKeys = allKeyList.filter(key => !locale.keys.includes(key));
        const coverage = allKeyList.length === 0
            ? '100.0'
            : ((locale.keys.length / allKeyList.length) * 100).toFixed(1);
        const status = missingKeys.length === 0 ? 'OK' : 'MISSING';

        console.log(`  ${status} ${locale.name}: ${locale.keys.length}/${allKeyList.length} (${coverage}%)`);
    }

    const localesWithMissing = locales
        .map(locale => ({
            ...locale,
            missingKeys: allKeyList.filter(key => !locale.keys.includes(key))
        }))
        .filter(locale => locale.missingKeys.length > 0);

    if (localesWithMissing.length > 0) {
        hasIssues = true;
        console.log('\nMissing keys:');

        for (const locale of localesWithMissing) {
            const sections = groupKeysBySection(locale.missingKeys);

            console.log(`\n  ERROR ${locale.name} missing ${locale.missingKeys.length} keys:`);
            for (const [section, keys] of Object.entries(sections)) {
                console.log(`    ${section}: ${keys.length} missing`);

                if (keys.length <= 5) {
                    for (const key of keys) {
                        console.log(`      - ${key}`);
                    }
                } else {
                    for (const key of keys.slice(0, 3)) {
                        console.log(`      - ${key}`);
                    }
                    console.log(`      ... and ${keys.length - 3} more`);
                }
            }
        }
    }

    if (hasIssues) {
        console.log('\nTranslation gaps found.');
    } else {
        console.log('\nAll locales fully covered.');
    }

    return hasIssues;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    try {
        process.exitCode = checkTranslations() ? 1 : 0;
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}

export { checkTranslations };
