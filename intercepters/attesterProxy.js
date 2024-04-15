import * as crypto from 'node:crypto'
import { Transform } from 'node:stream'
import { createServer } from '@harvard-lil/portal'

import { ScoopProxy } from './ScoopProxy.js'
import { ScoopProxyExchange } from '../exchanges/index.js'
import { searchBlocklistFor } from '../utils/blocklist.js'
import { CustomHeaders } from '../CustomHeaders.js'

import http from 'http' // eslint-disable-line
import net from 'net' // eslint-disable-line

/**
 * @class AttesterProxy
 * @extends ScoopProxy
 *
 * @classdesc
 * TBD
 */
export class AttesterProxy extends ScoopProxy {
      /** @type {CustomHeaders} */
    customHeaders
    attester


    constructor(options) {
        super(options); // Pass options to the parent constructor
        if(options.customHeaders)
            this.customHeaders = options.customHeaders;
          if(options.attester)  
            this.attester = options.attester;
      }
    
      onRequest(request, response) {


        if (this.recordExchanges) {
            this.exchanges.push(new ScoopProxyExchange({ requestParsed: request }))
          }
        // Full URL including the protocol, host, and path
        const fullUrl = request.url.startsWith('/')
          ? `https://${request.headers.host}${request.url}`
          : request.url;
    
        // Modify the request to include the full URL as the path
        request.url = fullUrl;
    
        // Setting the host to the forward proxy
        const forwardProxyHost = this.attester.forwardProxy.host;
        const forwardProxyPort = this.attester.forwardProxy.port;
        this.customHeaders.getCustomHeaders('request').forEach((header) => {
          request.headers[header.name] = header.value;
        })
    
        // Assuming `http.request` options are being set here (or wherever the actual request is made)
        const options = {
          hostname: forwardProxyHost,
          port: forwardProxyPort,
          path: fullUrl,
          method: request.method,
          headers: request.headers
        };
    
        // Create a new request to the forward proxy
        const proxyReq = http.request(options, (proxyResponse) => {

          const exchange = this.exchanges.find(ex => ex.requestParsed === request)
          
          if (exchange) {
            exchange.responseParsed = proxyResponse
            console.log("Exchange found for " + request.url + " with headers " + JSON.stringify(request.headers))
            console.log("Response has headers "  + JSON.stringify(proxyResponse.headers))
          }

          // Pipe the proxy's response directly back to the original client
          // proxyResponse.pipe(response);
  
          // Optionally, handle proxy response data or log it
          // proxyResponse.on('data', (chunk) => {
              // console.log('Data received from proxy:', chunk.toString());
          // });
      });
  
      request.pipe(proxyReq);  // Forward the client's request body to the proxy
  
      proxyReq.on('error', (err) => {
          console.error('Request to forward proxy failed:', err);
          response.writeHead(502, 'Bad Gateway');
          response.end('Failed to connect to the forward proxy');
      });
      }

      onResponse (response, request) {
        // there will not be an exchange with this request if we're, for instance, not recording
        // const exchange = this.exchanges.find(ex => ex.requestParsed === request)
    
        // if (exchange) {
        //   exchange.responseParsed = response
        // }
      }
}
