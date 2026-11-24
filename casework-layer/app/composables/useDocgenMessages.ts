import { useApiErrorMessage } from '~/composables/api/useApiErrorMessage';
import { isDocgenReason } from '~/utils/docgen-codes';
import { docgenErrorInfo } from '../utils/docgen';

/**
 * Localized messages for docgen proxy errors: the code's text plus, where the
 * backend names a reason (upload check, protected values), the explanation.
 */
export function useDocgenMessages() {
    const { t } = useI18n();
    const { resolveApiErrorMessage } = useApiErrorMessage();

    function docgenMessage(error: unknown, fallbackKey = 'docgen.internal_error'): string {
        const info = docgenErrorInfo(error);
        if (info.code === 'docgen.access_denied' && info.reason === 'protected_values') {
            return t('docgenUi.reasons.protected_values');
        }
        const base = resolveApiErrorMessage(error, fallbackKey);
        if (info.code === 'docgen.pdf_not_compliant' && info.validation) {
            return `${base} ${docgenValidationText(info.validation)}`.trim();
        }
        return isDocgenReason(info.reason) ? `${base} ${t(`docgenUi.reasons.${info.reason}`)}` : base;
    }

    /** What veraPDF objected to: the number of failed rules and its summary. */
    function docgenValidationText(validation: { failedRules: number, summary: string }): string {
        const rules = validation.failedRules > 0 ? t('docgenUi.validation.rules', { count: validation.failedRules }) : '';
        const summary = validation.summary ? t('docgenUi.validation.summary', { summary: validation.summary }) : '';
        return [rules, summary].filter(Boolean).join(' ');
    }

    /** Text for a release blocker or warning code. */
    function codeText(code: string): string {
        return code.startsWith('docgen.') ? t(code) : t('docgen.internal_error');
    }

    return { docgenMessage, codeText, docgenValidationText };
}
