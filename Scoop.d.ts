    export declare class Scoop {
        id: string;
        static states: {
            INIT: number;
            SETUP: number;
            CAPTURE: number;
            COMPLETE: number;
            PARTIAL: number;
            FAILED: number;
            RECONSTRUCTED: number;
        };
        state: number;
        url: string;
        targetUrlResolved: string;
        targetUrlIsWebPage: boolean;
        targetUrlContentType: string;
        options: any; // This could be more detailed with a ScoopOptions type if you define it
        exchanges: any[]; // Same as options, this could use a specific type
        log: any; // Replace with the type of your logger if available
        captureTmpFolderPath: string | null;
        startedAt: Date;
        // More properties and methods would follow here...

        constructor(url: string, options?: any);
        static capture(url: string, options?: {
            screenshot: boolean; 
            pdfSnapshot: boolean; 
            captureVideoAsAttachment: boolean; 
            captureTimeout: number; 
            loadTimeout: number; 
            captureWindowX: number; 
            captureWindowY: number;
            behaviorsPath: string;
            tmpFolderPath: string;
        }): any;
    }
