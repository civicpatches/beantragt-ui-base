import { parseUiMode } from './mode.mjs';

try {
    parseUiMode(process.env.BEANTRAGT_UI_MODE);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
await import('../../.output/server/index.mjs');
