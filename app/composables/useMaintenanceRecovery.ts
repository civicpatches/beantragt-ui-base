import { requestErrorStatus } from '~/utils/global-maintenance';
import { getCurrentScope, onScopeDispose } from 'vue';

export type MaintenanceRecoveryPhase = 'idle' | 'requesting' | 'code' | 'verifying' | 'disabling' | 'disable_error' | 'success';

export type MaintenanceRecoveryError = 'invalid_code' | 'rate_limited' | 'expired' | 'generic' | null;

interface RecoveryRequestResponse {
    success: true
    message: string
    expiresIn: number
    codeLength: 6
}

interface RecoveryVerifyResponse {
    success: true
    recoveryToken: string
    expiresIn: number
}

const RECOVERY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function positiveSeconds(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export const useMaintenanceRecovery = () => {
    const phase = ref<MaintenanceRecoveryPhase>('idle');
    const email = ref('');
    const code = ref('');
    const error = ref<MaintenanceRecoveryError>(null);
    const secondsRemaining = ref(0);
    let recoveryToken: string | null = null;
    let expiresAt = 0;
    let countdown: ReturnType<typeof setInterval> | null = null;

    function stopCountdown() {
        if (countdown) clearInterval(countdown);
        countdown = null;
        expiresAt = 0;
        secondsRemaining.value = 0;
    }

    function reset(resetError: MaintenanceRecoveryError = null) {
        stopCountdown();
        recoveryToken = null;
        phase.value = 'idle';
        email.value = '';
        code.value = '';
        error.value = resetError;
    }

    function updateCountdown() {
        secondsRemaining.value = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
        if (secondsRemaining.value === 0) reset('expired');
    }

    function startCountdown(seconds: number) {
        stopCountdown();
        expiresAt = Date.now() + seconds * 1000;
        updateCountdown();
        countdown = setInterval(updateCountdown, 1000);
    }

    function setRequestError(requestError: unknown) {
        error.value = requestErrorStatus(requestError) === 429 ? 'rate_limited' : 'generic';
    }

    async function requestCode(language?: unknown): Promise<boolean> {
        const normalizedEmail = email.value.trim();
        const locale = language === 'de' || language === 'en' ? language : null;
        if (!normalizedEmail) {
            error.value = 'generic';
            return false;
        }

        phase.value = 'requesting';
        error.value = null;
        code.value = '';
        try {
            const response = await $fetch<RecoveryRequestResponse>(
                '/api/platform/maintenance/recovery/request-code',
                {
                    method: 'POST',
                    body: { email: normalizedEmail },
                    ...(locale ? { headers: { 'Accept-Language': locale } } : {})
                }
            );
            const expiresIn = positiveSeconds(response?.expiresIn);
            if (response?.success !== true || response.codeLength !== 6 || !expiresIn) {
                throw new Error('Invalid recovery request response');
            }
            email.value = normalizedEmail;
            phase.value = 'code';
            startCountdown(expiresIn);
            return true;
        } catch (requestError: unknown) {
            phase.value = 'idle';
            setRequestError(requestError);
            return false;
        }
    }

    async function disableMaintenance(): Promise<boolean> {
        if (!recoveryToken) {
            phase.value = 'idle';
            error.value = 'generic';
            return false;
        }

        phase.value = 'disabling';
        error.value = null;
        try {
            const response = await $fetch<{ maintenance: boolean }>(
                '/api/platform/maintenance/recovery-disable',
                {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${recoveryToken}` }
                }
            );
            if (response?.maintenance !== false) {
                throw new Error('Invalid maintenance disable response');
            }
            recoveryToken = null;
            stopCountdown();
            phase.value = 'success';
            return true;
        } catch (disableError: unknown) {
            if (requestErrorStatus(disableError) === 429) {
                error.value = 'rate_limited';
                phase.value = 'disable_error';
            } else if (requestErrorStatus(disableError) === 401 || requestErrorStatus(disableError) === 403) {
                recoveryToken = null;
                stopCountdown();
                code.value = '';
                phase.value = 'idle';
                error.value = 'generic';
            } else {
                error.value = 'generic';
                phase.value = 'disable_error';
            }
            return false;
        }
    }

    async function verifyCode(): Promise<boolean> {
        const normalizedCode = code.value.trim();
        if (!/^\d{6}$/u.test(normalizedCode)) {
            error.value = 'invalid_code';
            return false;
        }

        phase.value = 'verifying';
        error.value = null;
        try {
            const response = await $fetch<RecoveryVerifyResponse>(
                '/api/platform/maintenance/recovery/verify-code',
                {
                    method: 'POST',
                    body: { email: email.value, code: normalizedCode }
                }
            );
            const expiresIn = positiveSeconds(response?.expiresIn);
            if (response?.success !== true
              || !RECOVERY_TOKEN_PATTERN.test(response.recoveryToken)
              || !expiresIn) {
                throw new Error('Invalid recovery verification response');
            }

            recoveryToken = response.recoveryToken;
            startCountdown(expiresIn);
            return disableMaintenance();
        } catch (verifyError: unknown) {
            recoveryToken = null;
            code.value = '';
            phase.value = 'code';
            const status = requestErrorStatus(verifyError);
            error.value = status === 401
                ? 'invalid_code'
                : status === 429
                    ? 'rate_limited'
                    : 'generic';
            return false;
        }
    }

    function editEmail() {
        stopCountdown();
        recoveryToken = null;
        code.value = '';
        error.value = null;
        phase.value = 'idle';
    }

    if (getCurrentScope()) onScopeDispose(stopCountdown);

    return {
        phase: readonly(phase),
        email,
        code,
        error: readonly(error),
        secondsRemaining: readonly(secondsRemaining),
        requestCode,
        verifyCode,
        disableMaintenance,
        editEmail,
        reset
    };
};
