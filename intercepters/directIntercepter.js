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

    // this.addResponseToExchange(response)

  }


  /**
 */
  async onRequestFailed(request) {
    const errorText = request.failure().errorText;
    // case when the request is aborted
    if (errorText == "net::ERR_ABORTED") {

      const status = "000";
      const statusMessage = "Aborted"
      const body = errorText + "\n" +
        "The network request was aborted by the client. Possible reasons include user navigation, JavaScript abort, or network issues."

      const response = {
        url: request.url(),
        startLine: `HTTP/1.1 ${status}  ${statusMessage}`,
        body: () => Buffer.from(body),
        request: () => request,
        status: () => status,
        statusText: () => statusMessage,
        headers: () => [],
      }
      this.addResponseToExchange(response)
    }
    else {
      console.log("DEBUG: onRequestFailed: ")
      console.log("URL: " + request.url())
      console.log("Headers: " + JSON.stringify(request.headers()))
      console.log("ERROR: " + request.failure().errorText)

    }


  }


  /**
 */
  async onRequestFinished(request) {
    const response = await request.response()
    if (response) {
      this.addResponseToExchange(response)
    }
    else {
      console.log("DEBUG: onRequestFinished with NOT REPONSE: ")
      console.log("URL: " + request.url())
      console.log("Headers: " + JSON.stringify(request.headers()))
    }
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
        if(ex.requestParsed.url != request.url){
          // console.log("Different URL for same path: " + request.url + " vs " + ex.requestParsed.url)

          // Check if it is a redirect, if yes, add as separate request-response pair
          if(ex.responseParsed?.statusCode && ex.responseParsed.statusCode == 301){
            //Add as separate request-response pair
            console.log("Previous redirect response found for request " + request.method + "  " + request.url)
            console.log("with path " + request.path)
            this.exchanges.push(new SimpleProxyExchange({ requestParsed: await convertRequest(response.request()), responseParsed: await convertResponse(response) }))
            break;
          }
          continue
        }
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
  const request = response.request();
  // console.log("++++++++++++++convertResponse++++++++++++++++")
  // console.log("For request " + request.method() + "  " + request.url())
  // console.log("with headers " + JSON.stringify(request.headers()))
  // console.log("Status: " + status)

  let bodyArray;
  if (status == 301) {
    bodyArray = Buffer.from('Redirected to ' + headers['location']);
  }
  else {
    if (request.method() == 'HEAD') {
      bodyArray = Buffer.from("No body, as a HEAD request was made.")
    }
    else if (request.method() == 'OPTIONS') {
      bodyArray = Buffer.from("No body, as a OPTIONS request was made.")
    }
    else {

      try {
        await new Promise(resolve => setTimeout(resolve, 100));
        // await response.finished();
        bodyArray = await response.body();
      }
      catch (e) {
        // console.log("Error for request " + request.method() + "  " + request.url())
        // console.log("with headers " + JSON.stringify(request.headers()))
        if (e.message.includes("No resource with given identifier found"))
          bodyArray = Buffer.from('Playwright error: No body data found');
        else {
          console.log("Error occured: " + e.message)
          bodyArray = Buffer.from('Playwright error: ' + e);
        }
      }
    }

  }

  //Convert body to Buffer
  let bodyBuffer = Buffer.from(bodyArray.buffer, bodyArray.byteOffset, bodyArray.byteLength);

  const mockServerResponse = {}
  mockServerResponse.statusCode = status;
  mockServerResponse.statusMessage = statusMessage;
  mockServerResponse.headers = headers;
  mockServerResponse.body = bodyBuffer;


  return mockServerResponse;
}

// checks if anything on the responses is different, except body length and content
function compareResponses(r1, r2){
  if(r1.statusCode != r2.statusCode)
    return false
  if(r1.statusMessage != r2.statusMessage)
    return false
  if(r1.headers.length != r2.headers.length)
    return false
  return true
}
