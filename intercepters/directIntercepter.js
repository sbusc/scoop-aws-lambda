import * as crypto from 'node:crypto'
import { Transform } from 'node:stream'
import { createServer } from '@harvard-lil/portal'

import { ScoopIntercepter } from './ScoopIntercepter.js'
import { SimpleProxyExchange } from '../exchanges/index.js'
import { searchBlocklistFor } from '../utils/blocklist.js'

import http from 'http' // eslint-disable-line
import net from 'net' // eslint-disable-line
import { Writable } from 'stream';
import EventEmitter from 'events';

/**
 * @class DirectIntercepter
 * @extends ScoopIntercepter
 *
 */
export class DirectIntercepter extends ScoopIntercepter {
  usesPage = true

  /** @type {Page} */
  page

  /** @type {SimpleProxyExchange[]} */
  exchanges = []

  /**
   * Initializes the proxy server
   * @returns {Promise<void>}
   */
  async setup() {
   // Do nothing
  }
  /**
   * Initializes the proxy server
   * @returns {Promise<void>}
   */
  async setupPage(page) {
    this.page = page

    await this.page.route('**', this.route.bind(this))

    this.page
      .on('request', this.onRequest.bind(this))
      .on('response', this.onResponse.bind(this))
      .on('requestfailed', this.onRequestFailed.bind(this))
      .on('requestfinished', this.onRequestFinished.bind(this))

  }
  /**
   * @param {http.ClientRequest} request
   * @returns {Transform}
   */
  requestTransformer(request) {
    return new Transform({
      transform: (chunk, _encoding, callback) => {
        callback(null, this.intercept('request', chunk, request))
      }
    })
  }

  /**
   * @param {http.ServerResponse} _response
   * @param {http.ClientRequest} request
   * @returns {Transform}
   */
  responseTransformer(_response, request) {
    return new Transform({
      transform: (chunk, _encoding, callback) => {
        callback(null, this.intercept('response', chunk, request))
      }
    })
  }

  /**
   * Attempts to close the proxy server. Skips after X seconds if unable to do so.
   * @returns {Promise<boolean>}
   */
  teardown() {
  }


  async route(route, request) {
    //TODO add headers for attester

    await route.continue()
  }


  /**
   * On request:
   * - Add to exchanges list (if currently recording exchanges)
   * - Check request against blocklist, block if necessary
   *
   * @param {http.ClientRequest} request
   */
  async onRequest(request) {
    this.addRequestToExchange(request);
  }


  /**
   * On response:
   * - Parse response
   * @param {http.ServerResponse} response
   * @param {http.ClientRequest} request
   */
  async onResponse(response) {
    this.addResponseToExchange(response)


  }


  /**
 */
  onRequestFailed(response, request) {
    console.log("DEBUG: onRequestFailed: ")
  }


  /**
 */
  onRequestFinished(response, request) {

  }


  /**
   * The proxy info to be consumed by Playwright.
   * Includes a flag to ignore certificate errors introduced by proxying.
   *
   * @property {object} proxy
   * @property {string} proxy.server The proxy url
   * @property {boolean} ignoreHTTPSErrors=true
   */
  get contextOptions() {
    return {
    }
  }

  /**
   * Checks an outgoing request against the blocklist. Interrupts the request it needed.
   * Keeps trace of blocked requests in `Scoop.provenanceInfo`.
   *
   * @param {string} toMatch
   * @returns {boolean} - `true` if a match was found in the blocklist
   */
  findMatchingBlocklistRule(toMatch) {
    // Search for a blocklist match:
    // Use the index to pull the original un-parsed rule from options so that the printing matches user expectations
    return this.capture.options.blocklist[
      this.capture.blocklist.findIndex(searchBlocklistFor(toMatch))
    ]
  }

  /**
   * "Blocks" a request by writing HTTP 403 to request socket.
   * @param {http.ClientRequest} request
   * @param {string} match
   * @param {object} rule
   */
  blockRequest(request, match, rule) {
    request.socket.write(
      'HTTP/1.1 403 Forbidden\r\n\r\n' +
      `During capture, request for ${match} matched blocklist rule ${rule} and was blocked.`
    )
    this.capture.log.warn(`Blocking ${match} matching rule ${rule}`)
    this.capture.provenanceInfo.blockedRequests.push({ match, rule })
  }

  /**
   * Collates network data (both requests and responses) from the proxy.
   * Post-capture checks and capture size enforcement happens here.
   * Acts as a transformer in the proxy pipeline and therefor must return
   * the data to be passed forward.
   *
   * @param {string} type
   * @param {Buffer} data
   * @param {SimpleProxyExchange} exchange
   * @returns {Buffer}
   */
  intercept(type, data, request) {
    const exchange = this.exchanges.find(ex => ex.requestParsed === request)
    if (!exchange) return data // Early exit if not recording exchanges

    const prop = `${type}Raw` // `responseRaw` | `requestRaw`
    exchange[prop] = Buffer.concat([exchange[prop], data])

    this.byteLength += data.byteLength
    this.checkAndEnforceSizeLimit() // From parent

    return data
  }

  async addRequestToExchange(request) {
    if (this.recordExchanges) {
      this.exchanges.push(new SimpleProxyExchange({ requestParsed: await convertRequest(request) }))
    }

  }

  async addResponseToExchange(response) {

    const request = await convertRequest(response.request())

    let exchange = undefined

    for (const ex of this.exchanges) {
      if (ex.requestParsed.method == request.method && ex.requestParsed.path == request.path) {
        exchange = ex;
        break
      }
    }

    if (exchange) {
      exchange.responseParsed = await convertResponse(response)
    }
  }

}

async function convertRequest(request) {
  const urlString = await request.url()
  const url = new URL(urlString);
  const method = await request.method();
  const headers = await request.headers();
  const body = await request.postDataBuffer() || Buffer.from('');
  // Simulate the http.ClientRequest object
  const mockClientRequest = {}
  // Add properties to mock the behavior of a real http.ClientRequest
  mockClientRequest.url = urlString;
  mockClientRequest.method = method;
  mockClientRequest.path = url.pathname;
  mockClientRequest.headers = headers;
  mockClientRequest.body = body; // Include body data
  return mockClientRequest;
}

async function convertResponse(response) {

  const status = await response.status();
  const statusMessage = await response.statusText()
  const headers = await response.headers();
  const bodyArray = await response.body();

  //Convert body to Buffer
  let bodyBuffer = Buffer.from(bodyArray.buffer, bodyArray.byteOffset, bodyArray.byteLength);

  const mockServerResponse = {}
  mockServerResponse.statusCode = status;
  mockServerResponse.statusMessage = statusMessage;
  mockServerResponse.headers = headers;
  mockServerResponse.body = bodyBuffer;


  return mockServerResponse;
}
// class MockServerResponse extends Writable {
//   constructor(options) {
//       super(options);
//       EventEmitter.call(this);  // Mixin EventEmitter
//       this.headers = {};
//       this.statusCode = 200;
//       this.body = Buffer.alloc(0);
//   }

//   writeHead(statusCode, headers) {
//       this.statusCode = statusCode;
//       this.headers = headers;
//       console.log('Status Code set:', statusCode);
//       console.log('Headers set:', headers);
//   }

//   write(data, encoding, callback) {
//       super.write(data, encoding, callback); // Properly use the stream write
//       this.body = Buffer.concat([this.body, Buffer.isBuffer(data) ? data : Buffer.from(data)]);
//       this.emit('data', data);  // Ensure 'data' event is emitted
//       return true;
//   }

//   end(data, encoding, callback) {
//       if (data) {
//           this.write(data, encoding, () => {});
//       }
//       super.end(() => {  // Call super.end to ensure the stream is closed correctly
//           this.emit('end');
//           console.log('Response has been sent.');
//           if (callback) callback();
//       });
//   }
// }

// Mix in the EventEmitter properties
// Object.assign(MockServerResponse.prototype, EventEmitter.prototype);