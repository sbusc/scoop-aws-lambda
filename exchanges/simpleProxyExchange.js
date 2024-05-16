/// <reference path="./ScoopExchange.types.js" />

import { getBody } from '../utils/http.js'

import { ScoopProxyExchange } from './ScoopProxyExchange.js'

const HTTP_VERSION = '1.1'

/**
 * @class SimpleProxyExchange
 * @extends ScoopProxyExchange
 *
 * @classdesc
 * A simplified version of the ScoopProxyExchange, suitable for use in direct interception.
 *
 * @param {object} [props={}] - Object containing any of the properties of `this`.
 */
export class SimpleProxyExchange extends ScoopProxyExchange {
  constructor(props = {}) {
    super(props)

    const setters = Object.getOwnPropertyNames(this.constructor.prototype)
    for (const [key, value] of Object.entries(props)) {
      if (key in this || setters.includes(key)) {
        this[key] = value
      }
    }
  }

  get url() {
    if (!this._url && this.requestParsed) {
      this.url = this.requestParsed.url.startsWith('/')
        ? `https://${this.requestParsed.headers.host}${this.requestParsed.url}`
        : this.requestParsed.url
    }

    return this._url
  }

  set url(val) {
    // throw on invalid url
    new URL(val) // eslint-disable-line
    this._url = val
  }

  /**
   * @type {?Buffer}
   * @private
   */
  _requestRaw = Buffer.from([])

  /** @type {?Buffer} */
  get requestRaw() {
    return this._requestRaw
  }

  set requestRaw(val) {
    this._request = null
    this._requestRaw = val
  }

  /**
   * @type {?Buffer}
   * @private
   */
  _responseRaw = Buffer.from([])

  /** @type {?Buffer} */
  get responseRaw() {
    return this._responseRaw
  }

  set responseRaw(val) {
    this._response = null
    this._responseRaw = val
  }

  /**
   * Stores the parsed body on the incoming message for easy access
   *
   * @param {IncomingMessage} message
   * @private
   */
  _cacheBody(message) {
    message.on('data', (data) => {
      message.body = message.body
        ? Buffer.concat([message.body, data])
        : data
    })
  }

  /**
   * @type {?IncomingMessage}
   * @private
   */
  _requestParsed

  /** @type {?IncomingMessage} */
  get requestParsed() {

    return this._requestParsed
  }

  set requestParsed(val) {
    this._request = null
    // this._cacheBody(val)
    this._requestParsed = val
    this.url = val.url
  }

  /**
   * @type {?IncomingMessage}
   * @private
   */
  _responseParsed

  /** @type {?IncomingMessage} */
  get responseParsed() {
    return this._responseParsed
  }

  set responseParsed(val) {
    this._response = null
    // this._cacheBody(val)
    this._responseParsed = val
  }

  /**
   * @type {?object}
   * @private
   */
  _request

  /** @type {?ScoopExchange~Message} */
  get request() {
    if (!this._request && this.requestParsed) {
      this.request = {
        url: this.url,
        startLine: `${this.requestParsed.method} ${this.requestParsed.url} HTTP/${HTTP_VERSION}`,
        headers: new Headers(this.requestParsed.headers),
        body: this.requestParsed.body,
        bodyCombined: this.requestParsed.body
      }
    }
    return this._request
  }

  set request(val) {
    this._request = val
  }

  /**
   * @type {?object}
   * @private
   */
  _response

  /** @type {?ScoopExchange~Message} */
  get response() {
    // TODO: figure out why this.responseRaw may sometimes be an empty buffer of length 0
    if (!this._response) {
      try {

        //sbusc: abort if responseParsed is not set
        if(!this.responseParsed)
          return undefined

        this.response = {
          url: this.url,
          startLine: `HTTP/${HTTP_VERSION} ${this.responseParsed.statusCode} ${this.responseParsed.statusMessage}`,
          headers: new Headers(sanitizeHeaders(this.responseParsed.headers)),
          body: this.responseParsed.body,
          bodyCombined: this.responseParsed.body
        }
      }
      catch (e) {
        console.log("Error trying to build response object: " + e)
        console.log("For url: " + this.url)
      }
    }
    return this._response
  }

  set response(val) {
    this._response = val
  }
}
function sanitizeHeaders(headers) {
  const sanitizedHeaders = {};

  for (const [key, value] of Object.entries(headers)) {
    // Remove any '\n' or '\r' characters
    const sanitizedValue = value.replace(/[\r\n]/g, '');
    sanitizedHeaders[key] = sanitizedValue;
  }

  return sanitizedHeaders;
}
