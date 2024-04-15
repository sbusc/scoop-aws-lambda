/**
 * @class CustomHeaders
 *
 * @classdesc
 * To validate and store custom headers
 *
 */
export class CustomHeaders {

    /**
     * @typedef {object} CustomHeaders
     * @property {string} type - 'request' or 'response'
     * @property {string} name - Name of the header - needs to conform with HTTP header name rules
     * @property {string} value - Value of this header field - needs to conform with HTTP header value rules
     * @property {boolean} transient - If true, this header will NOT be added to the final WARC file
     */

    /** @type {CustomHeaders[]} */
    customHeaders = []

    /**
     * Instantiates a Scoop instance and runs the capture
     *
    * @param {string} type - 'request' or 'response'
    * @param {string} name - Name of the header - needs to conform with HTTP header name rules
    * @param {string} value - Value of this header field - needs to conform with HTTP header value rules
    * @param {?boolean} transient - If true, this header will NOT be added to the final WARC file
    */
  addCustomHeader(type, name, value, transient=false){
        this.customHeaders.push({type, name, value, transient})
    }
    getCustomHeaders(type){
        return this.customHeaders.filter(header => header.type === type);
    }

}
