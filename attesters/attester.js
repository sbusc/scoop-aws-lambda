/**
 * @class Attester
 * @abstract
 *
 * @classdesc
 * Abstract class for attester implementations
 *
 */
export class Attester {
    /**
     * @type {?string}
     */
    attesterType
    attesterOptions

    constructor (attesterOptions) {
        this.attesterOptions = attesterOptions;
    } 
    validateAttesterType() {
        if (!this.attesterOptions.attesterType || this.attesterOptions.attesterType !== this.attesterType) {
            throw new Error('AttesterOptions are for a different type of attester');
        }
    }
    setChromiumOptions(options) {
        throw new Error('Cannot be called on an abstract class')
    }

    addCustomHeaders(customHeaders) {
        throw new Error('Cannot be called on an abstract class')
    }

}