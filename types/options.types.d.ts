// options.types.d.ts

// Define the log levels as a type since they are a limited set of strings.
type LogLevel = "silent" | "trace" | "debug" | "info" | "warn" | "error";

// Interface for ScoopOptions, translating the JS documentation to TypeScript types.
export interface ScoopOptions {
    logLevel?: LogLevel;
    screenshot?: boolean;
    pdfSnapshot?: boolean;
    domSnapshot?: boolean;
    captureVideoAsAttachment?: boolean;
    captureCertificatesAsAttachment?: boolean;
    provenanceSummary?: boolean;
    attachmentsBypassLimits?: boolean;
    captureTimeout?: number;
    loadTimeout?: number;
    networkIdleTimeout?: number;
    behaviorsTimeout?: number;
    captureVideoAsAttachmentTimeout?: number;
    captureCertificatesAsAttachmentTimeout?: number;
    captureWindowX?: number;
    captureWindowY?: number;
    maxCaptureSize?: number;
    autoScroll?: boolean;
    autoPlayMedia?: boolean;
    grabSecondaryResources?: boolean;
    runSiteSpecificBehaviors?: boolean;
    headless?: boolean;
    userAgentSuffix?: string;
    blocklist?: string[];
    intercepter?: string;
    proxyHost?: string;
    proxyPort?: number;
    proxyVerbose?: boolean;
    publicIpResolverEndpoint?: string;
    ytDlpPath?: string;
    cripPath?: string;
    behaviorsPath?: string; // Added by sbusc
    tmpFolderPath?: string; // Added by sbusc
    browser?: string; // Added by sbusc
    excludeFavicon?: boolean; // Added by sbusc
}
