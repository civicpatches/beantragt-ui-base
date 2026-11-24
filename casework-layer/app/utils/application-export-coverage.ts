export interface ApplicationExportCoverageOptions {
    showFormColumn?: boolean
    hasSchema?: boolean
}

export function isMetadataOnlyApplicationExport(options: ApplicationExportCoverageOptions): boolean {
    return options.showFormColumn === true && options.hasSchema !== true;
}
