/**
 * Defines authentication methods for attesters.
 * @typedef {Object} attesterAuth
 * @property {string} type - Type of authentication.
 */

/**
 * Extends attesterAuth for basic authentication.
 * @typedef {Object} attesterAuthBasic
 * @extends attesterAuth
 * @property {string} username - Username for basic auth.
 * @property {string} password - Password for basic auth.
 */

/**
 * Extends attesterAuth for bearer token authentication.
 * @typedef {Object} attesterAuthBearer
 * @extends attesterAuth
 * @property {string} token - Bearer token.
 */

/**
 * Defines proxy settings.
 * @typedef {Object} forwardProxy
 * @property {string} host - Hostname of the proxy.
 * @property {number} port - Port number of the proxy.
 * @property {attesterAuth} auth - Authentication details (optional).
 */

/**
 * Available options and defaults for Scoop.
 * @typedef {Object} AttesterOptions
 * @property {string} attesterType="standard" - Defines what kind of attester should be used.
 * @property {forwardProxy} forwardProxy - Proxy settings to use.
 * @property {string} [timestampProof] - Specifies if a timestamp proof is required.
 */
