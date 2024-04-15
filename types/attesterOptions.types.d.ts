// attesterOptions.types.d.ts

// Define the forwardProxy info
type forwardProxy = {
    host: string;
    port: number;
    auth?: attesterAuth;
};
interface attesterAuth {
    type: string;
}
interface attesterAuthBasic extends attesterAuth {
    type: 'basic';
    username: string;
    password: string;
}
interface attesterAuthBearer extends attesterAuth {
    type: 'bearer';
    token: string;
}

// Interface for AttesterOptions, translating the JS documentation to TypeScript types.
export interface AttesterOptions {
    forwardProxy: forwardProxy;
    timestampProof?: string;

}
