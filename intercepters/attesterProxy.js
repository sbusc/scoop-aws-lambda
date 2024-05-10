import * as crypto from 'node:crypto'
import { Transform } from 'node:stream'
import { createServer } from '@harvard-lil/portal'

import { DirectIntercepter } from './directIntercepter.js'
import { ScoopProxyExchange } from '../exchanges/index.js'
import { searchBlocklistFor } from '../utils/blocklist.js'
import { CustomHeaders } from '../CustomHeaders.js'

import http from 'http' // eslint-disable-line
import net from 'net' // eslint-disable-line

/**
 * @class AttesterProxy
 * @extends DirectIntercepter
 *
 * @classdesc
 * TBD
 */
export class AttesterProxy extends DirectIntercepter {
  /** @type {CustomHeaders} */
  customHeaders
  attester
  log


  constructor(options) {
    super(options); // Pass options to the parent constructor
    this.log = options.log
    if (options.customHeaders)
      this.customHeaders = options.customHeaders;
    if (options.attester)
      this.attester = options.attester;
  }

  async route(route, request) {
    const headers = {
      ...request.headers()
    }
    this.customHeaders.getCustomHeaders('request').forEach((header) => {
      headers[header.name] = header.value;
    })
    await route.continue({headers})
    this.addRequestToExchange(request);
    }
    async onRequest(request) {
      // Do nothing - this is done in route() instead
    }
  

}
