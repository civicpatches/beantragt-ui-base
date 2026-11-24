import type { Component, InjectionKey } from 'vue';

export interface DocumentPreviewSource {
    url: string
    blob: Blob
    mime?: 'application/pdf' | 'image/jpeg' | 'image/png'
    title: string
    filename?: string
}

export const documentPreviewExtensionKey: InjectionKey<Component<{ preview?: DocumentPreviewSource, fill?: boolean }>> = Symbol('documentPreviewExtension');
