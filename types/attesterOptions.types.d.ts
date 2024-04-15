// attesterOptions.types.d.ts

// Define the forwardProxy info
export type forwardProxy = {
    host: string;
    port: number;
    auth?: attesterAuth;
};
export interface attesterAuth {
    type: string;
}
export interface attesterAuthBasic extends attesterAuth {
    type: 'basic';
    username: string;
    password: string;
}
export interface attesterAuthBearer extends attesterAuth {
    type: 'bearer';
    token: string;
}

// Interface for AttesterOptions, translating the JS documentation to TypeScript types.
export interface AttesterOptions {
    forwardProxy: forwardProxy;
    timestampProof?: string;

}
