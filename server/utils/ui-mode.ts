import { parseUiMode } from '../../scripts/ui-mode/mode.mjs';
import type { UiMode } from '../../shared/ui-mode';

export function serverUiMode(): UiMode {
    return parseUiMode(process.env.BEANTRAGT_UI_MODE);
}
