/**
 * Context shared by the independently registered decision, delivery, transfer and supplement sections.
 * Each Pro section talks to the page through this context; placement belongs to the case layout.
 *
 * State the panels read is handed over as refs (always the page's current values); the page creates the context
 * once. Handlers a panel registers with `on…` return their remover; a panel removes them when it unmounts (the
 * page outlives the panels: they remount with every completed refresh).
 *
 * Part of the open case-work layer (moves with the detail slice, contract 3.4). Nothing registered: the outlet
 * renders nothing and no handler is ever called.
 */
import type { Ref } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import type { CasePendingTransfer, CaseTransferTrigger } from '~/types/case-transfers';

/** What the panels read of the application. */
export interface CaseDetailApplication {
    id: string
    schemaId: string | null
    created?: string
    statusFlags: string[]
}

export type CaseStatusChangedHandler = () => Promise<void> | void;
export type CaseDataSavedHandler = (waitingTransferIds: string[], dataChanged: boolean) => Promise<void> | void;
export type CaseResponseReleasedHandler = () => void;

export interface CaseDetailPanelContext {
    // page to panel: state
    applicationId: string
    application: Readonly<Ref<CaseDetailApplication | null>>
    isStaff: Readonly<Ref<boolean>>
    isAdmin: Readonly<Ref<boolean>>
    /** The page may edit the application data (today's `!dataEditDisabled`). */
    canEditData: Readonly<Ref<boolean>>
    /** The card "Ablauf" of the form, where its functions are switched on (admins only). */
    formWorkflowTo: Readonly<Ref<RouteLocationRaw | null>>
    /** The name of the page's manual status action, or null when there is none. */
    manualStatusAction: Readonly<Ref<string | null>>
    /** The page's workspace route for a path. */
    workspaceRoute: (path: string) => Exclude<RouteLocationRaw, string>
    // panel to page
    /** A panel action runs (`source` names the panel); the page blocks its own mutations meanwhile. */
    setBusy: (source: string, busy: boolean) => void
    /** Reloads the application (the page's refresh). */
    refreshApplication: () => Promise<void>
    /** Remounts the response list (its previews changed). */
    bumpResponses: () => void
    /** Opens the data editor and moves the focus there. */
    requestDataEdit: () => Promise<void>
    /** The transfers that wait for sending; a data edit stops them, the data card names their connections. */
    setPendingTransfers: (list: readonly CasePendingTransfer[]) => void
    /** When the transfer starts, for the status dialog. */
    setTransferTrigger: (trigger: CaseTransferTrigger | null, canApprove: boolean) => void
    // page to panel: events
    /** After a status change and the page's reload (a status change may plan a transfer). */
    onStatusChanged: (handler: CaseStatusChangedHandler) => () => void
    /** After a successful data save: the transfers that waited before it, and whether the data changed. */
    onDataSaved: (handler: CaseDataSavedHandler) => () => void
    /** After the response list released a response. */
    onResponseReleased: (handler: CaseResponseReleasedHandler) => () => void
}

/** A set of handlers the page calls in registration order; `add` returns the remover. */
export function caseDetailHandlers<T extends (...args: never[]) => unknown>() {
    const handlers = new Set<T>();
    return {
        add(handler: T): () => void {
            handlers.add(handler);
            return () => {
                handlers.delete(handler);
            };
        },
        /** The handlers registered (a copy: a handler that unregisters while they run is still called once). */
        current(): T[] {
            return [...handlers];
        }
    };
}
