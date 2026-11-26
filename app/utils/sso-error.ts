const SSO_ERROR_MESSAGES = {
    rate_limited: 'auth.login.ssoErrors.rateLimited',
    unavailable: 'auth.login.ssoErrors.unavailable',
    login_failed: 'auth.login.ssoErrors.loginFailed',
    acs_rejected: 'auth.login.ssoErrors.acsRejected',
    assurance_insufficient: 'auth.login.ssoErrors.assuranceInsufficient',
    account_ineligible: 'auth.login.ssoErrors.accountIneligible',
    account_privileged: 'auth.login.ssoErrors.accountPrivileged',
    mock_not_allowed: 'auth.login.ssoErrors.mockNotAllowed'
} as const;

export function isSsoErrorCode(code: unknown): code is keyof typeof SSO_ERROR_MESSAGES {
    return typeof code === 'string' && Object.hasOwn(SSO_ERROR_MESSAGES, code);
}

export function ssoErrorMessageKey(code: unknown) {
    return isSsoErrorCode(code) ? SSO_ERROR_MESSAGES[code] : 'auth.login.ssoError';
}
