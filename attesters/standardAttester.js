import { Attester } from './index.js';
import { CustomHeaders } from "../CustomHeaders.js";

/**
 * @class StandardAttester
 * @extends Attester
 *
 * @classdesc
 * Represents the standard implementation of the attester interface.
 *
 */
export class StandardAttester extends Attester {
    attesterType='standard';
    forwardProxy;
    timestampProof;

    constructor (attesterOptions) {
        super(attesterOptions);

        this.forwardProxy = attesterOptions.forwardProxy;
        this.timestampProof = attesterOptions.timestampProof;

        this.validateAttesterType();
    }
    
    setChromiumOptions(options) {
        if(this.forwardProxy && this.forwardProxy.host && this.forwardProxy.port) {
            options.proxy = {
                server: this.forwardProxy.host + ":" + this.forwardProxy.port
            }
            if(this.forwardProxy.auth && this.forwardProxy.auth.type === 'basic') {
                options.username = this.forwardProxy.auth.username
                options.password = this.forwardProxy.auth.password
                }
        }        
    }
    /**
     * Adds custom headers to the request or response.
     *
    * @param {CustomHeaders} customHeaders - the CustomHeaders object
    */
    addCustomHeaders(customHeaders) {
        if(this.timestampProof){
            customHeaders.addCustomHeader('request', 'Timestamp-Proof', this.timestampProof, false)
        }
        if(this.forwardProxy.auth && this.forwardProxy.auth.type === 'bearer') {
            customHeaders.addCustomHeader('request', 'Attester-Authorization', "Bearer " + this.forwardProxy.auth.token, true)
        }
    }
}