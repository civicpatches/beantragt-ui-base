export type DeliveryAdapter = 'mock' | 'webhook' | 'fit_connect';

export interface DeliverySettingsResponse {
    data: {
        enabled: boolean
        autoEnqueue: boolean
        defaultAdapter: DeliveryAdapter
        defaultAdapterRequiresAssignment: boolean
        maxAttempts: number
        adapters: {
            mock: {
                available: boolean
                target: string
            }
            webhook: {
                available: boolean
                targetUrl: string
                targetHost: string | null
                secretEnv: string
                secretConfigured: boolean
                allowedHosts: string[]
                timeoutSeconds: number
                missing: string[]
            }
            fitConnect: {
                available: boolean
                status: string
            }
        }
    }
}
