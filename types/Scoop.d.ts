
import { AttesterOptions } from './attesterOptions.types.js';
import { ScoopOptions } from './options.types.js';

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
    options: ScoopOptions; // This could be more detailed with a ScoopOptions type if you define it
    exchanges: any[]; // Same as options, this could use a specific type
    log: any; // Replace with the type of your logger if available
    captureTmpFolderPath: string | null;
    startedAt: Date;
    // More properties and methods would follow here...

    constructor(url: string, options?: ScoopOptions);
    static capture(url: string, options?: ScoopOptions, attesterOptions?: AttesterOptions ): any;
}
    