/// <reference path="./options.types.js" />

import os from 'os'
import { readFile, rm, readdir, mkdir, mkdtemp, access } from 'fs/promises'
import { constants as fsConstants } from 'node:fs'
import { createHash } from 'crypto'

import log from 'loglevel'
import logPrefix from 'loglevel-plugin-prefix'
import nunjucks from 'nunjucks'
import { Address4, Address6 } from '@laverdet/beaugunderson-ip-address'
import { v4 as uuidv4 } from 'uuid'
import * as playwright from 'playwright-aws-lambda'
import * as playwrightCore from 'playwright-core'
import { getOSInfo } from 'get-os-info'

import { exec } from './utils/exec.js'
import { ScoopGeneratedExchange } from './exchanges/index.js'
import { castBlocklistMatcher, searchBlocklistFor } from './utils/blocklist.js'

import * as CONSTANTS from './constants.js'
import * as intercepters from './intercepters/index.js'
import * as exporters from './exporters/index.js'
import * as importers from './importers/index.js'
import * as attesters from './attesters/index.js'
import * as browserLaunchers from './browserLaunchers/index.js'
import { filterOptions, defaults } from './options.js'
import { formatErrorMessage } from './utils/formatErrorMessage.js'
import { CustomHeaders } from './CustomHeaders.js'
import { StandardAttester } from './attesters/standardAttester.js'
import { writeAllExchangesToFile } from './debugKit.js'

nunjucks.configure(CONSTANTS.TEMPLATES_PATH)

/**
 * @class Scoop
 *
 * @classdesc
 * Experimental single-page web archiving library using Playwright.
 * Uses a proxy to allow for comprehensive and raw network interception.
 *
 * @example
 * import { Scoop } from "scoop";
 *
 * const myCapture = await Scoop.capture("https://example.com");
 * const myArchive = await myCapture.toWARC();
 */
export class Scoop {
  /** @type {string} */
  id = uuidv4()

  /**
   * Enum-like states that the capture occupies.
   * @readonly
   * @enum {number}
   */
  static states = {
    INIT: 0,
    SETUP: 1,
    CAPTURE: 2,
    COMPLETE: 3,
    PARTIAL: 4,
    FAILED: 5,
    RECONSTRUCTED: 6
  }

  /**
   * Current state of the capture.
   * Should only contain states defined in `states`.
   * @type {number}
   */
  state = Scoop.states.INIT

  /**
   * URL to capture.
   * @type {string}
   */
  url = ''

  /**
   * URL to capture, resolved to account for redirects.
   * Populated during non-web content detection step.
   * @type {string}
   */
  targetUrlResolved = ''

  /**
   * Is the target url a web page?
   * Assumed `true` until detected otherwise.
   * @type {boolean}
   */
  targetUrlIsWebPage = true

  /**
   * Content-type of the target url.
   * Assumed `text/html` unless detected otherwise.
   * @type {string}
   */
  targetUrlContentType = 'text/html; charset=utf-8'

  /**
   * Current settings.
   * @type {ScoopOptions}
   */
  options = {}

  /**
   * sbusc: added
   * Current attester instance
   * @type {CustomHeaders}
   */
  customHeaders

  /**
   * sbusc: added
   * Current attester instance
   * @type {attesters.Attester}
   */
  attester

  /**
   * Returns a copy of Scoop's default settings.
   * @type {ScoopOptions}
   */
  static get defaults() {
    return Object.assign({}, defaults)
  }

  /**
   * Array of HTTP exchanges that constitute the capture.
   * Only contains generated exchanged until `teardown()`.
   * @type {ScoopExchange[]}
   */
  exchanges = []

  /**
   * Logger.
   * Logging level controlled via the `logLevel` option.
   * @type {?log.Logger}
   */
  log = log

  /**
   * Path to the capture-specific temporary folder created by `setup()`.
   * Will be a child folder of the path defined in `CONSTANTS.TMP_PATH`.
   * @type {?string}
   */
  captureTmpFolderPath = null

  /**
   * The time at which the page was crawled.
   * @type {Date}
   */
  startedAt

  /**
   * The Playwright browser instance for this capture.
   * @type {Browser}
   */
  #browser

  /**
   * Reference to the intercepter chosen for capture.
   * @type {intercepters.ScoopIntercepter}
   */
  intercepter

  /**
   * Reference to the intercepter chosen for capture.
   * @type {browserLaunchers.abstractBrowser}
   */
  browsers

  /**
   * A mirror of options.blocklist with IPs parsed for matching
   * @type {Array.<String|RegEx|Address4|Address6>}
   */
  blocklist = []

  /**
   * Captures information about the context of this capture.
   * @type {{
   *   captureIp: ?string,
   *   userAgent: ?string,
   *   software: ?string,
   *   version: ?string,
   *   osType: ?string,
   *   osName: ?string,
   *   osVersion: ?string,
   *   cpuArchitecture: ?string,
   *   blockedRequests: Array.<{match: string, rule: string}>,
   *   certificates: Array.<{host: string, pem: string}>,
   *   ytDlpHash: string,
   *   cripHash: string,
   *   options: ScoopOptions,
   * }}
   */
  provenanceInfo = {
    blockedRequests: [],
    certificates: []
  }

  /**
   * Info extracted by the browser about the page on initial load
   * @type {{
   *   title: ?string,
   *   description: ?string,
   *   url: ?string,
   *   faviconUrl: ?string,
   *   favicon: ?Buffer
   * }}
   */
  pageInfo = {}

  /**
   * @param {string} url - Must be a valid HTTP(S) url.
   * @param {?ScoopOptions} [options={}] - See {@link ScoopOptions}.
   * @param {?attesters.AttesterOptions} attesterOptions - See {@link AttesterOptions}.
   */
  constructor(url, options = {}, attesterOptions) {
    this.options = filterOptions(options)
    this.blocklist = this.options.blocklist.map(castBlocklistMatcher)
    this.url = this.filterUrl(url)
    this.targetUrlResolved = this.url


    //sbusc: added
    this.customHeaders = new CustomHeaders()
    if (attesterOptions) {
      this.attester = Scoop.loadAttester(attesterOptions)
      this.attester.addCustomHeaders(this.customHeaders);
    }

    // Logging setup (level, output formatting)
    logPrefix.reg(this.log)
    logPrefix.apply(log, {
      format(level, _name, timestamp) {
        const timestampColor = CONSTANTS.LOGGING_COLORS.DEFAULT
        const msgColor = CONSTANTS.LOGGING_COLORS[level.toUpperCase()]
        return `${timestampColor(`[${timestamp}]`)} ${msgColor(level)}`
      }
    })
    this.log.setLevel(this.options.logLevel)

    this.intercepter = new intercepters[this.options.intercepter](this)
    this.browserLauncher = new browserLaunchers[this.options.browser](this)
  }

  /**
   * Instantiates a Scoop instance and runs the capture
   *
   * @param {string} url - Must be a valid HTTP(S) url.
   * @param {ScoopOptions} [options={}] - See {@link ScoopOptions}.
   * @param {attesters.AttesterOptions} attesterOptions
   * @returns {Promise<Scoop>}
   */
  static async capture(url, options, attesterOptions) {
    const instance = new Scoop(url, options, attesterOptions)
    await instance.capture()
    return instance
  }

  /**
   * Main capture process (internal).
   * @returns {Promise<void>}
   * @private
   */
  async capture() {
    const options = this.options

    /**
     * @typedef {object} CaptureStep
     * @property {string} name
     * @property {?function} setup
     * @property {?function} main
     * @property {?boolean} alwaysRun - If true, this step will run regardless of capture-level time / size constraints.
     * @property {?boolean} webPageOnly - If true, this step will only run if the target url is a web page. Takes precedence over `alwaysRun`.
     */

    /** @type {CaptureStep[]} */
    const steps = []


    //
    // Prepare capture steps
    //

    // Push step: early detection of non-web resources
    steps.push({
      name: 'Out-of-browser detection and capture of non-web resource',
      alwaysRun: true,
      webPageOnly: false,
      main: async (page) => {
        await this.#detectAndCaptureNonWebContent(page)
      }
    })

    // Push step: Wait for initial page load
    steps.push({
      name: 'Wait for initial page load',
      alwaysRun: false,
      webPageOnly: true,
      main: async (page) => {
        await page.goto(this.url, { waitUntil: 'load', timeout: options.loadTimeout })
      }
    })

    // Push step: Capture page info
    steps.push({
      name: 'Capture page info',
      alwaysRun: options.attachmentsBypassLimits,
      webPageOnly: true,
      main: async (page) => {
        await this.#capturePageInfo(page)
      }
    })

    // Push step: Browser scripts
    if (
      options.grabSecondaryResources ||
      options.autoPlayMedia ||
      options.runSiteSpecificBehaviors ||
      options.autoScroll
    ) {
      steps.push({
        name: 'Browser scripts',
        alwaysRun: false,
        webPageOnly: true,
        setup: async (page) => {
          // Determine path of `behaviors.js`
          let behaviorsPath = './node_modules/browsertrix-behaviors/dist/behaviors.js'
          // sbusc: added to make behaviorsPath configurable
          if (options.behaviorsPath) {
            console.log(`Setting custom behaviorsPath: ${options.behaviorsPath}`)
            behaviorsPath = options.behaviorsPath
          }
          try {
            await access(behaviorsPath)
          } catch (_err) {
            console.log(`Could not access custom behaviorsPath: ${options.behaviorsPath}`)
            const fallbackPath = `${CONSTANTS.BASE_PATH}/node_modules/browsertrix-behaviors/dist/behaviors.js`
            console.log(`Setting behaviorsPath to default: ${fallbackPath}`)
            behaviorsPath = fallbackPath
          }

          await page.addInitScript({
            path: behaviorsPath
          })
          await page.addInitScript({
            content: `
              self.__bx_behaviors.init({
                autofetch: ${options.grabSecondaryResources},
                autoplay: ${options.autoPlayMedia},
                autoscroll: ${options.autoScroll},
                siteSpecific: ${options.runSiteSpecificBehaviors},
                timeout: ${options.behaviorsTimeout}
              });`
          })
        },
        main: async (page) => {
          await Promise.allSettled(
            page.frames().map((frame) => frame.evaluate('self.__bx_behaviors.run()'))
          )
        }
      })
    }

    // Push step: Wait for network idle
    steps.push({
      name: 'Wait for network idle',
      alwaysRun: false,
      webPageOnly: true,
      main: async (page) => {
        await page.waitForLoadState('networkidle', { timeout: options.networkIdleTimeout })
      }
    })

    // Push step: scroll up
    steps.push({
      name: 'Scroll-up',
      alwaysRun: options.attachmentsBypassLimits,
      webPageOnly: true,
      main: async (page) => {
        await Promise.race([
          page.evaluate(() => window.scrollTo(0, 0)),
          new Promise(resolve => setTimeout(resolve, 2500)) // Only wait for up to 2.5s for scroll up to happen
        ])
      }
    })

    // Push step: Screenshot
    if (options.screenshot) {
      steps.push({
        name: 'Screenshot',
        alwaysRun: options.attachmentsBypassLimits,
        webPageOnly: true,
        main: async (page) => {
          const url = 'file:///screenshot.png'
          const httpHeaders = new Headers({ 'content-type': 'image/png' })
          //sbusc: Changed this so it works on AWS lambda
          // const body = await page.screenshot({ fullPage: true, timeout: 5000 })
          await page.setViewportSize({
            width: 1000,
            height: 600,
          });
          const body = await page.screenshot()
          const isEntryPoint = true
          const description = `Capture Time Screenshot of ${this.url}`

          this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint, description)
        }
      })
    }

    // Push step: DOM Snapshot
    if (options.domSnapshot) {
      steps.push({
        name: 'DOM snapshot',
        alwaysRun: options.attachmentsBypassLimits,
        webPageOnly: true,
        main: async (page) => {
          const url = 'file:///dom-snapshot.html'
          const httpHeaders = new Headers({
            'content-type': 'text/html',
            'content-disposition': 'Attachment'
          })
          const body = Buffer.from(await page.content())
          const isEntryPoint = true
          const description = `Capture Time DOM Snapshot of ${this.url}`

          this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint, description)
        }
      })
    }

    // Push step: PDF Snapshot
    if (options.pdfSnapshot) {
      steps.push({
        name: 'PDF snapshot',
        alwaysRun: options.attachmentsBypassLimits,
        webPageOnly: true,
        main: async (page) => {
          await this.#takePdfSnapshot(page)
        }
      })
    }

    // Push step: Capture of in-page videos as attachment
    if (options.captureVideoAsAttachment) {
      steps.push({
        name: 'Out-of-browser capture of video as attachment (if any)',
        alwaysRun: options.attachmentsBypassLimits,
        webPageOnly: true,
        main: async () => {
          await this.#captureVideoAsAttachment()
        }
      })
    }

    // Push step: certs capture
    if (options.captureCertificatesAsAttachment) {
      steps.push({
        name: 'Capturing certificates info',
        alwaysRun: options.attachmentsBypassLimits,
        webPageOnly: false,
        main: async () => {
          await this.#captureCertificatesAsAttachment()
        }
      })
    }

    // Push step: Provenance summary
    if (options.provenanceSummary) {
      steps.push({
        name: 'Provenance summary',
        alwaysRun: options.attachmentsBypassLimits,
        webPageOnly: false,
        main: async (page) => {
          await this.#captureProvenanceInfo(page)
        }
      })
    }

    // Initialize capture
    //
    let page

    try {
      page = await this.setup()
      this.log.info(`Scoop ${CONSTANTS.VERSION} was initialized with the following options:`)
      this.log.info(options)
      this.log.info(`🍨 Starting capture of ${this.url}.`)
      this.state = Scoop.states.CAPTURE
    } catch (err) {
      this.log.error(`An error occurred during capture setup (${formatErrorMessage(err)}).`)
      this.log.trace(err)
      this.state = Scoop.states.FAILED
      return // exit early if the browser and proxy couldn't be launched
    }

    //
    // Call `setup()` method of steps that have one
    //
    for (const step of steps.filter((step) => step.setup)) {
      await step.setup(page)
    }

    //
    // Run capture steps
    //
    let i = -1
    while (i++ < steps.length - 1) {
      const step = steps[i]

      //
      // Edge cases requiring immediate interruption
      //
      let shouldStop = false

      // Page is a web document and is still "about:blank" after step #2
      if (this.targetUrlIsWebPage && i > 1 && page.url() === 'about:blank') {
        this.log.error('Navigation to page failed (about:blank).')
        shouldStop = true
      }

      // Page was closed
      if (this.targetUrlIsWebPage && page.isClosed()) {
        this.log.error('Page closed before it could be captured.')
        shouldStop = true
      }

      if (shouldStop) {
        this.state = Scoop.states.FAILED
        break
      }

      //
      // If capture was not interrupted, run steps
      //
      try {
        // Only if state is `CAPTURE`, unless `alwaysRun` is set for step
        let shouldRun = this.state === Scoop.states.CAPTURE || step.alwaysRun === true

        // BUT: `webPageOnly` takes precedence - allows for skipping unnecessary steps when capturing non-web content
        if (this.targetUrlIsWebPage === false && step.webPageOnly) {
          shouldRun = false
        }

        if (shouldRun === false) {
          this.log.warn(`STEP [${i + 1}/${steps.length}]: ${step.name} (skipped)`)
          continue
        }

        this.log.info(`STEP [${i + 1}/${steps.length}]: ${step.name}`)

        /** @type {?function} */
        let stateCheckInterval = null

        await Promise.race([
          // Run current step
          step.main(page),

          // Check capture state every second - so current step can be interrupted if state changes
          new Promise(resolve => {
            stateCheckInterval = setInterval(() => {
              if (this.state !== Scoop.states.CAPTURE && step.alwaysRun !== true) {
                resolve(true)
              }
            }, 1000)
          })
        ])

        clearInterval(stateCheckInterval) // Clear "state checker" interval in case it is still running
        //
        // On error:
        // - Only deliver full trace if error is not due to time / size limit reached.
        //
      } catch (err) {
        if (this.state === Scoop.states.PARTIAL) {
          this.log.warn(`STEP [${i + 1}/${steps.length}]: ${step.name} - ended due to max time or size reached.`)
        } else {
          this.log.warn(`STEP [${i + 1}/${steps.length}]: ${step.name} - failed`)
          this.log.trace(err)
        }
      }
    }

    //
    // Post-capture
    //
    if (this.state === Scoop.states.CAPTURE) {
      this.state = Scoop.states.COMPLETE
    }




    //sbusc: Write all exchanges into a file - in debug mode
    if(this.options.logLevel == 'debug' || this.options.logLevel == 'trace'){
      const debugLogFilname = "./debugLog.csv"
      await writeAllExchangesToFile(this.intercepter.exchanges, debugLogFilname)  
    }

    await this.teardown()
  }

  /**
   * Sets up the proxy and Playwright resources, creates capture-specific temporary folder.
   *
   * @returns {Promise<Page>} Resolves to a Playwright [Page]{@link https://playwright.dev/docs/api/class-page} object
   */
  async setup() {
    this.startedAt = new Date()
    this.state = Scoop.states.SETUP
    const options = this.options
    let tmpFolderPath = CONSTANTS.TMP_PATH
    if (options.tmpFolderPath) {
      tmpFolderPath = options.tmpFolderPath
    }

    // Create "base" temporary folder if it doesn't exist
    let tmpDirExists = false
    try {
      await access(tmpFolderPath)
      tmpDirExists = true
    } catch (_err) {
      this.log.info(`Base temporary folder ${tmpFolderPath} does not exist or cannot be accessed. Scoop will attempt to create it.`)
    }

    if (!tmpDirExists) {
      try {
        await mkdir(tmpFolderPath)
        await access(tmpFolderPath, fsConstants.W_OK)
        tmpDirExists = true
      } catch (err) {
        this.log.warn(`Error while creating base temporary folder ${tmpFolderPath} ((${formatErrorMessage(err)})).`)
        this.log.trace(err)
      }
    }

    // Create captures-specific temporary folder under base temporary folder
    try {
      this.captureTmpFolderPath = await mkdtemp(tmpFolderPath)
      this.captureTmpFolderPath += '/'
      await access(this.captureTmpFolderPath, fsConstants.W_OK)

      this.log.info(`Capture-specific temporary folder ${this.captureTmpFolderPath} created.`)
    } catch (err) {
      try {
        await rm(this.captureTmpFolderPath)
      } catch { /* Ignore: Deletes the capture-specific folder if it was created, if possible. */ }

      throw new Error(`Scoop was unable to create a capture-specific temporary folder.\n${err}`)
    }

    // Initialize intercepter (proxy)
    await this.intercepter.setup()

    // Playwright init + pass proxy info to Chromium
    // sbusc: changed to playwright-core
    const userAgent = playwrightCore.devices['Desktop Chrome'].userAgent + options.userAgentSuffix
    // Original code
    // const userAgent = chromium._playwright.devices['Desktop Chrome'].userAgent + options.userAgentSuffix
    this.provenanceInfo.userAgent = userAgent
    this.log.info(`User Agent used for capture: ${userAgent}`)

    let chromiumOptions = {
      headless: options.headless
    }
    if (this.attester) {
      this.attester.setChromiumOptions(chromiumOptions)
    }


    // sbusc: changed to playwright-core
    this.#browser = await this.browserLauncher.launchBrowser(chromiumOptions)
    // Original code
    // this.#browser = await chromium.launch({...

    const context = await this.#browser.newContext({
      ...this.intercepter.contextOptions,
      // ignoreHTTPSErrors: false,
      userAgent
    })

    const page = await context.newPage()

    page.setViewportSize({
      width: options.captureWindowX,
      height: options.captureWindowY
    })

    // Enforce capture timeout
    const captureTimeoutTimer = setTimeout(() => {
      this.log.info(`captureTimeout of ${options.captureTimeout}ms reached. Ending further capture.`)
      this.state = Scoop.states.PARTIAL
      this.intercepter.recordExchanges = false
    }, options.captureTimeout)

    this.#browser.on('disconnected', () => {
      clearTimeout(captureTimeoutTimer)
    })

    if (this.intercepter.usesPage) {
      await this.intercepter.setupPage(page)
    }

    return page
  }

  /**
   * Tears down Playwright, intercepter, and capture-specific temporary folder.
   * @returns {Promise<void>}
   */
  async teardown() {
    this.log.info('Closing browser and intercepter')
    await this.intercepter.teardown()
    await this.#browser.close()

    this.exchanges = this.intercepter.exchanges.concat(this.exchanges)

    this.log.info(`Clearing capture-specific temporary folder ${this.captureTmpFolderPath}`)
    await rm(this.captureTmpFolderPath, { recursive: true, force: true })
  }

  /**
   * Creates an Attester-Object based on the given options.
   *
   *
   * @param {attesters.AttesterOptions} attesterOptions - Options for the attester
   * @returns {attesters.Attester} - The attester instance
   * @private
   */
  static loadAttester(attesterOptions) {
    // sbusc
    if (attesterOptions.attesterType != 'standard')
      throw new Error('Only standard attester is supported for now')

    return new attesters.StandardAttester(attesterOptions)
  }

  /**
   * Assesses whether `this.url` leads to a non-web resource and, if so:
   * - Captures it via a curl behind our proxy
   * - Sets capture state to `PARTIAL`
   *
   * Populates `this.targetUrlIsWebPage` and `this.targetUrlContentType`.
   *
   * @param {Page} page - A Playwright [Page]{@link https://playwright.dev/docs/api/class-page} object
   * @returns {Promise<void>}
   * @private
   */
  async #detectAndCaptureNonWebContent(page) {
    /** @type {?string} */
    let contentType = null

    /** @type {?number} */
    let contentLength = null

    /**
     * Time spent on the initial HEAD request, in ms.
     * @type {?number}
     */
    let headRequestTimeMs = null

    //
    // Is `this.url` leading to a text/html resource?
    //
    try {
      const before = new Date()

      // Timeout = a 10th of captureTimeout if >= 1 second, 1 second otherwise.
      let timeout = this.options.captureTimeout / 10

      if (timeout < 1000) {
        timeout = 1000
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const headRequest = await fetch(this.url, {
        method: 'HEAD',
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      const after = new Date()

      headRequestTimeMs = after - before

      this.targetUrlResolved = headRequest.url
      contentType = headRequest.headers.get('Content-Type')
      contentLength = headRequest.headers.get('Content-Length')
    } catch (err) {
      this.log.trace(err)
      this.log.warn('Resource type detection failed - skipping')
      return
    }

    // Capture content-type
    if (contentType) {
      this.targetUrlContentType = contentType
    }

    // If text/html or no content-type, bail from non-web content capture process.
    // Scoop.capture will go based on the value of `this.targetUrlIsWebPage`.
    if (!contentType) {
      this.log.info('Requested URL is assumed to be a web page (no content-type found)')
      return
    }

    if (contentType?.startsWith('text/html')) {
      this.log.info('Requested URL is a web page')
      return
    }

    this.targetUrlIsWebPage = false
    this.log.warn(`Requested URL is not a web page (detected: ${contentType})`)
    this.log.info('Scoop will attempt to capture this resource out-of-browser')

    //
    // Check if curl is present
    //
    try {
      await exec('curl', ['-V'])
    } catch (err) {
      this.log.trace(err)
      this.log.warn('curl is not present on this system - skipping')
      return
    }

    //
    // Capture using curl behind proxy
    //
    try {
      const userAgent = this.provenanceInfo.userAgent

      let timeout = this.options.captureTimeout - headRequestTimeMs

      if (timeout < 1000) {
        timeout = 1000
      }

      const curlOptions = [
        this.url,
        '--header', `"User-Agent: ${userAgent}"`,
        '--output', '/dev/null',
        '--proxy', `'http://${this.options.proxyHost}:${this.options.proxyPort}'`,
        '--insecure', // TBD: SSL checks are delegated to the proxy
        '--location',
        // This will be the only capture step running:
        // use all available time - time spent on first request
        '--max-time', Math.floor(timeout / 1000)
      ]

      await exec('curl', curlOptions, { timeout })
    } catch (err) {
      this.log.trace(err)
    }

    //
    // Report on results and:
    // - Set capture state to PARTIAL if _anything_ was captured.
    // - Leave capture state to CAPTURE otherwise.
    //
    if (this.intercepter.exchanges.length > 0) {
      const intercepted = this.intercepter.exchanges[0]?.response?.body?.byteLength

      if (intercepted === Number(contentLength)) {
        this.log.info(`Resource fully captured (${contentLength} bytes)`)
      } else {
        this.log.warn(`Resource partially captured (${intercepted} of ${contentLength} bytes)`)
      }

      this.state = Scoop.states.PARTIAL
    } else {
      this.log.warn('Resource could not be captured')
    }
  }

  /**
   * Tries to populate `this.pageInfo`.
   * Captures page title, description, url and favicon url directly from the browser.
   * Will attempt to find the favicon in intercepted exchanges if running in headfull mode, and request it out-of-band otherwise.
   *
   * @param {Page} page - A Playwright [Page]{@link https://playwright.dev/docs/api/class-page} object
   * @returns {Promise<void>}
   * @private
   */
  async #capturePageInfo(page) {
    this.pageInfo = await page.evaluate(() => {
      return {
        title: document.title,
        description: document.querySelector("meta[name='description']")?.content,
        url: window.location.href,
        faviconUrl: document.querySelector("link[rel*='icon']")?.href,
        favicon: null
      }
    })

    //
    // Favicon processing
    //
    if (this.options.excludeFavicon) {
      this.log.info('Favicon capture is disabled')
      return
    }
    // Not needed if:
    // - No favicon URL found
    // - Favicon url is not an http(s) URL
    if (!this.pageInfo?.faviconUrl) {
      return
    }

    if (!this.pageInfo.faviconUrl.startsWith('http')) {
      return
    }

    // If `headless`: request the favicon using curl so it's added to the exchanges list.
    if (this.options.headless) {
      try {
        const userAgent = this.provenanceInfo.userAgent

        const timeout = 1000

        const curlOptions = [
          this.pageInfo.faviconUrl,
          '--header', `"User-Agent: ${userAgent}"`,
          '--output', '/dev/null',
          '--proxy', `'http://${this.options.proxyHost}:${this.options.proxyPort}'`,
          '--insecure', // TBD: SSL checks are delegated to the proxy
          '--max-time', Math.floor(timeout / 1000)
        ]

        await exec('curl', curlOptions, { timeout })
      } catch (err) {
        this.log.warn(`Could not fetch favicon at url ${this.pageInfo.faviconUrl}.`)
        this.log.trace(err)
      }
    }

    // Look for favicon in exchanges
    for (const exchange of this.intercepter.exchanges) {
      if (exchange?.url && exchange.url === this.pageInfo.faviconUrl && exchange?.response?.body) {
        this.pageInfo.favicon = exchange.response.body
      }
    }
  }

  /**
   * Runs `yt-dlp` on the current url to try and capture:
   * - The "main" video(s) of the current page (`file:///video-extracted-x.mp4`)
   * - Associated subtitles (`file:///video-extracted-x.LOCALE.vtt`)
   * - Associated meta data (`file:///video-extracted-metadata.json`)
   *
   * These elements are added as "attachments" to the archive, for context / playback fallback purposes.
   * A summary file and entry point, `file:///video-extracted-summary.html`, will be generated in the process.
   *
   * @returns {Promise<void>}
   * @private
   */
  async #captureVideoAsAttachment() {
    const videoFilename = `${this.captureTmpFolderPath}video-extracted-%(autonumber)d.mp4`
    const ytDlpPath = this.options.ytDlpPath

    let metadataRaw = null
    let metadataParsed = null

    let videoSaved = false
    let metadataSaved = false
    let subtitlesSaved = false

    /**
     * Key: video filename (ex: "video-extracted-1").
     * Value: array of subtitle locales (ex: ["en-US", "fr-FR"])
     * @type {Object<string, string[]>}
     */
    const availableVideosAndSubtitles = {}

    //
    // yt-dlp health check
    //
    try {
      const version = await exec(ytDlpPath, ['--version']).then((v) => v.trim())

      if (!version.match(/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}$/)) {
        throw new Error(`Unknown version: ${version}`)
      }
    } catch (err) {
      this.log.trace(err)
      throw new Error('"yt-dlp" executable is not available or cannot be executed.')
    }

    //
    // Try and pull video(s) and meta data from url
    //
    try {
      this.intercepter.recordExchanges = false

      const dlpOptions = [
        '--dump-json', // Will return JSON meta data via stdout
        '--no-simulate', // Forces download despites `--dump-json`
        '--no-warnings', // Prevents pollution of stdout
        '--no-progress', // (Same as above)
        '--write-subs', // Try to pull subs
        '--sub-langs', 'all',
        '--format', 'mp4', // Forces .mp4 format
        '--output', `"${videoFilename}"`,
        '--no-check-certificate',
        '--proxy', `'http://${this.options.proxyHost}:${this.options.proxyPort}'`,
        this.url
      ]

      const spawnOptions = {
        timeout: this.options.captureVideoAsAttachmentTimeout,
        maxBuffer: 1024 * 1024 * 128
      }

      metadataRaw = await exec(ytDlpPath, dlpOptions, spawnOptions)
    } catch (err) {
      this.log.trace(err)
      throw new Error(`No video found in ${this.url}.`)
    } finally {
      this.intercepter.recordExchanges = true
    }

    //
    // Add available video(s) and subtitles to exchanges
    //
    for (const file of await readdir(this.captureTmpFolderPath)) {
      // Video
      if (file.startsWith('video-extracted-') && file.endsWith('.mp4')) {
        try {
          const url = `file:///${file}`
          const httpHeaders = new Headers({ 'content-type': 'video/mp4' })
          const body = await readFile(`${this.captureTmpFolderPath}${file}`)
          const isEntryPoint = false // TODO: Reconsider whether this should be an entry point.

          this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint)
          videoSaved = true

          // Push to map of available videos and subtitles
          const index = file.replace('.mp4', '')

          if (!(index in availableVideosAndSubtitles)) {
            availableVideosAndSubtitles[index] = []
          }
        } catch (err) {
          this.log.warn(`Error while creating exchange for ${file}.`)
          this.log.trace(err)
        }
      }

      // Subtitles
      if (file.startsWith('video-extracted-') && file.endsWith('.vtt')) {
        try {
          const url = `file:///${file}`
          const httpHeaders = new Headers({ 'content-type': 'text/vtt' })
          const body = await readFile(`${this.captureTmpFolderPath}${file}`)
          const isEntryPoint = false
          const locale = file.split('.')[1]

          // Example of valid locales: "en", "en-US"
          if (!locale.match(/^[a-z]{2}$/) && !locale.match(/[a-z]{2}-[A-Z]{2}/)) {
            continue
          }

          this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint)
          subtitlesSaved = true

          // Push to map of available videos and subtitles
          const index = file.replace('.vtt', '').replace(`.${locale}`, '')

          if (!(index in availableVideosAndSubtitles)) {
            availableVideosAndSubtitles[index] = []
          }

          availableVideosAndSubtitles[index].push(locale)
        } catch (err) {
          this.log.warn(`Error while creating exchange for ${file}.`)
          this.log.trace(err)
        }
      }
    }

    //
    // Try to add metadata to exchanges
    //
    try {
      metadataParsed = []

      // yt-dlp returns JSONL when there is more than 1 video
      for (const line of metadataRaw.split('\n')) {
        if (line) {
          metadataParsed.push(JSON.parse(line)) // May throw
        }
      }

      const url = 'file:///video-extracted-metadata.json'
      const httpHeaders = new Headers({ 'content-type': 'application/json' })
      const body = Buffer.from(JSON.stringify(metadataParsed, null, 2))
      const isEntryPoint = false

      this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint)
      metadataSaved = true
    } catch (err) {
      this.log.warn('Error while creating exchange for file:///video-extracted-medatadata.json.')
      this.log.trace(err)
    }

    //
    // Generate summary page
    //
    try {
      const html = nunjucks.render('video-extracted-summary.njk', {
        url: this.url,
        now: new Date().toISOString(),
        videoSaved,
        metadataSaved,
        subtitlesSaved,
        availableVideosAndSubtitles,
        metadataParsed
      })

      const url = 'file:///video-extracted-summary.html'
      const httpHeaders = new Headers({ 'content-type': 'text/html' })
      const body = Buffer.from(html)
      const isEntryPoint = true
      const description = `Extracted Video data from: ${this.url}`

      this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint, description)
    } catch (err) {
      this.log.warn('Error while creating exchange for file:///video-extracted-summary.html.')
      this.log.trace(err)
    }
  }

  /**
   * Tries to generate a PDF snapshot from Playwright and add it as a generated exchange (`file:///pdf-snapshot.pdf`).
   * Dimensions of the PDF are based on current document width and height.
   *
   * @param {Page} page - A Playwright [Page]{@link https://playwright.dev/docs/api/class-page} object
   * @returns {Promise<void>}
   */
  async #takePdfSnapshot(page) {
    let pdf = null
    let dimensions = null

    await page.emulateMedia({ media: 'screen' })

    // Pull dimensions from live browser
    dimensions = await page.evaluate(() => {
      const width = Math.max(document.body.scrollWidth, window.outerWidth)
      const height = Math.max(document.body.scrollHeight, window.outerHeight) + 50
      return { width, height }
    })

    // Generate PDF
    pdf = await page.pdf({
      printBackground: true,
      width: dimensions.width,
      height: dimensions.height
    })

    const url = 'file:///pdf-snapshot.pdf'
    const httpHeaders = new Headers({ 'content-type': 'application/pdf' })
    const body = pdf
    const isEntryPoint = true
    const description = `Capture Time PDF Snapshot of ${this.url}`

    this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint, description)
  }

  /**
   * Runs `crip` against the different origins the capture process encountered.
   * Captures certificates as `file:///[origin].pem`).
   * Populates `this.provenanceInfo.certificates`.
   *
   * @returns {Promise<void>}
   * @private
   */
  async #captureCertificatesAsAttachment() {
    const { captureCertificatesAsAttachmentTimeout, cripPath } = this.options

    //
    // Start timeout timer
    //
    let timeIsOut = false
    const timer = setTimeout(() => { timeIsOut = true }, captureCertificatesAsAttachmentTimeout)

    //
    // Check that `crip` is available
    //
    try {
      await exec(cripPath)
    } catch (err) {
      this.log.trace(err)
      throw new Error('"crip" executable is not available or cannot be executed.')
    }

    //
    // Pull certs
    //
    const processedHosts = new Map()

    for (const exchange of this.intercepter.exchanges) {
      const url = new URL(exchange.url)

      if (timeIsOut) {
        throw new Error('Capture certificates at attachment timeout reached')
      }

      if (url.protocol !== 'https:' || processedHosts.get(url.host) === true) {
        continue
      }

      if (this.blocklist.find(searchBlocklistFor(`https://${url.host}`))) {
        this.log.warn(`${url.host} matched against blocklist - skipped trying to pull its certificate.`)
        continue
      }

      try {
        const cripOptions = [
          'print',
          '-u', `https://${url.host}`,
          '-f', 'pem'
        ]

        let timeout = captureCertificatesAsAttachmentTimeout

        if (processedHosts.length > 0) { // Timeout per request decreases as we go through the list.
          timeout = captureCertificatesAsAttachmentTimeout / processedHosts.length
        }

        const spawnOptions = {
          timeout: timeout > 1000 ? timeout : 1000,
          maxBuffer: 1024 * 1024 * 128
        }

        const pem = await exec(cripPath, cripOptions, spawnOptions)

        processedHosts.set(url.host, true)

        if (!pem) {
          throw new Error(`crip did not return a PEM for ${url.host}.`)
        }

        // Add to generated exchanges
        const fileUrl = `file:///${url.host}.pem`
        const httpHeaders = new Headers({ 'content-type': 'application/x-pem-file' })
        const body = Buffer.from(pem)
        const isEntryPoint = false
        await this.addGeneratedExchange(fileUrl, httpHeaders, body, isEntryPoint)

        // Add to `this.provenanceInfo.certificates`
        this.provenanceInfo.certificates.push({ host: url.host, pem })
      } catch (err) {
        this.log.trace(err)
        this.log.warn(`Certificates could not be extracted for ${url.host}`)
      }
    }

    clearTimeout(timer)
  }

  /**
   * Populates `this.provenanceInfo`, which is then used to generate a `file:///provenance-summary.html` exchange and entry point.
   * That property is also be used by `scoopToWACZ()` to populate the `extras` field of `datapackage.json`.
   *
   * Provenance info collected:
   * - Capture client IP, resolved using the endpoint provided in the `publicIpResolverEndpoint` option.
   * - Operating system details (type, name, major version, CPU architecture)
   * - Scoop version
   * - Scoop options object used during capture
   *
   * @param {Page} page - A Playwright [Page]{@link https://playwright.dev/docs/api/class-page} object
   * @private
   */
  async #captureProvenanceInfo(page) {
    let captureIp = 'UNKNOWN'
    const osInfo = await getOSInfo()
    let ytDlpHash = ''
    let cripHash = ''

    // Grab public IP address - uses CURL
    try {
      const response = await exec('curl', [
        this.options.publicIpResolverEndpoint,
        '--max-time', '3'
      ])

      const ip = response.trim()

      try {
        new Address4(ip) // eslint-disable-line
      } catch {
        try {
          new Address6(ip) // eslint-disable-line
        } catch {
          throw new Error(`${ip} is not a valid IP address.`)
        }
      }

      captureIp = ip
    } catch (err) {
      this.log.warn('Public IP address could not be found.')
      this.log.trace(err)
    }

    // Compute yt-dlp hash
    try {
      ytDlpHash = createHash('sha256')
        .update(await readFile(this.options.ytDlpPath))
        .digest('hex')

      ytDlpHash = `sha256:${ytDlpHash}`
    } catch (err) {
      this.log.warn('Could not compute SHA256 hash of yt-dlp executable')
      this.log.trace(err)
    }

    // Compute crip hash
    try {
      cripHash = createHash('sha256')
        .update(await readFile(this.options.cripPath))
        .digest('hex')

      cripHash = `sha256:${cripHash}`
    } catch (err) {
      this.log.warn('Could not compute SHA256 hash of crip executable')
      this.log.trace(err)
    }

    // Gather provenance info
    this.provenanceInfo = {
      ...this.provenanceInfo,
      captureIp,
      software: CONSTANTS.SOFTWARE,
      version: CONSTANTS.VERSION,
      osType: os.type(),
      osName: osInfo.name,
      osVersion: osInfo.version,
      cpuArchitecture: os.machine(),
      ytDlpHash,
      cripHash,
      options: structuredClone(this.options)
    }

    // ytDlpPath and cripPath should be excluded from provenance summary
    delete this.provenanceInfo.options.ytDlpPath
    delete this.provenanceInfo.options.cripPath

    // Generate summary page
    try {
      const html = nunjucks.render('provenance-summary.njk', {
        ...this.provenanceInfo,
        date: this.startedAt.toISOString(),
        url: this.url
      })

      const url = 'file:///provenance-summary.html'
      const httpHeaders = new Headers({ 'content-type': 'text/html' })
      const body = Buffer.from(html)
      const isEntryPoint = true
      const description = 'Provenance Summary'

      this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint, description)
    } catch (err) {
      throw new Error(`Error while creating exchange for file:///provenance-summary.html. ${err}`)
    }
  }

  /**
   * Generates a ScoopGeneratedExchange for generated content and adds it to `exchanges`.
   *
   * @param {string} url
   * @param {Headers} headers
   * @param {Buffer} body
   * @param {boolean} [isEntryPoint=false]
   * @param {string} [description='']
   * @returns {boolean} true if generated exchange is successfully added
   */
  addGeneratedExchange(url, headers, body, isEntryPoint = false, description = '') {
    // Check maxCaptureSize and capture state unless `attachmentsBypassLimits` flag was raised.
    if (this.options.attachmentsBypassLimits === false) {
      const remainingSpace = this.options.maxCaptureSize - this.intercepter.byteLength

      if (this.state !== Scoop.states.CAPTURE || body.byteLength >= remainingSpace) {
        this.state = Scoop.states.PARTIAL
        this.log.warn(`Generated exchange ${url} could not be saved (size limit reached).`)
        return false
      }
    }

    this.exchanges.push(
      new ScoopGeneratedExchange({
        url,
        description,
        isEntryPoint: Boolean(isEntryPoint),
        response: {
          startLine: 'HTTP/1.1 200 OK',
          headers,
          body
        }
      })
    )

    return true
  }

  /**
   * Filters a url to ensure it's suitable for capture.
   * This function throws if:
   * - `url` is not a valid url
   * - `url` is not an http / https url
   * - `url` matches a blocklist rule
   *
   * @param {string} url
   */
  filterUrl(url) {
    let pass = true

    // Is the url "valid"? (format)
    try {
      const filteredUrl = new URL(url) // Will throw if not a valid url

      if (filteredUrl.protocol !== 'https:' && filteredUrl.protocol !== 'http:') {
        this.log.error('Invalid protocol.')
        pass = false
      }

      url = filteredUrl.href
    } catch (err) {
      this.log.error(`Invalid url provided.\n${err}`)
      pass = false
    }

    // If the url part of the blocklist?
    const rule = this.blocklist.find(searchBlocklistFor(url))
    if (rule) {
      this.log.error(`Blocked url provided matching blocklist rule: ${rule}`)
      pass = false
    }

    if (!pass) {
      throw new Error('Invalid URL provided.')
    }

    return url
  }

  /**
   * Returns a map of "generated" exchanges.
   * Generated exchanges = anything generated directly by Scoop (PDF snapshot, full-page screenshot, videos ...) as opposed to naturally intercepted.
   * @returns {Object.<string, ScoopGeneratedExchange>}
   */
  extractGeneratedExchanges() {
    if (![Scoop.states.COMPLETE, Scoop.states.PARTIAL].includes(this.state)) {
      throw new Error('Cannot export generated exchanges on a pending or failed capture.')
    }

    const generatedExchanges = {}

    for (const exchange of this.exchanges) {
      if (exchange instanceof ScoopGeneratedExchange) {
        const key = exchange.url.replace('file:///', '')
        generatedExchanges[key] = exchange
      }
    }

    return generatedExchanges
  }

  /**
   * (Shortcut) Reconstructs a Scoop capture from a WACZ.
   * @param {string} zipPath - Path to .wacz file.
   * @returns {Promise<Scoop>}
   */
  static async fromWACZ(zipPath) {
    return await importers.WACZToScoop(zipPath)
  }

  /**
   * (Shortcut) Export this Scoop capture to WARC.
   * @param {boolean} [gzip=false]
   * @returns {Promise<ArrayBuffer>}
   */
  async toWARC(gzip = false) {
    return await exporters.scoopToWARC(this, Boolean(gzip))
  }

  /**
   * (Shortcut) Export this Scoop capture to WACZ.
   * @param {boolean} [includeRaw=true] - Include a copy of RAW HTTP exchanges to the wacz (under `/raw`)?
   * @param {object} signingServer - Optional server information for signing the WACZ
   * @param {string} signingServer.url - url of the signing server
   * @param {string} signingServer.token - Optional token to be passed to the signing server via the Authorization header
   * @returns {Promise<ArrayBuffer>}
   */
  async toWACZ(includeRaw = true, signingServer) {
    return await exporters.scoopToWACZ(this, includeRaw, signingServer)
  }

  /**
   * @typedef {Object} ScoopCaptureSummary
   * @property {int} state
   * @property {string[]} states - Zero-indexed Scoop.states values.
   * @property {string} targetUrl
   * @property {boolean} targetUrlIsWebPage
   * @property {string} targetUrlContentType
   * @property {ScoopOptions} options
   * @property {string} startedAt - ISO-formatted date
   * @property {object} attachments - Summary of generated exchange filenames.
   * @property {?string} attachments.provenanceSummary - Filename
   * @property {?string} attachments.screenshot - Filename
   * @property {?string} attachments.pdfSnapshot - Filename
   * @property {?string} attachments.domSnapshot - Filename
   * @property {?string} attachments.videoExtractedSummary - Filename
   * @property {?string} attachments.videoExtractedMetadata - Filename
   * @property {?string[]} attachments.videoExtracted - Filenames
   * @property {?string[]} attachments.videoExtractedSubtitles - Filenames
   * @property {?string[]} attachments.certificates - Filenames
   * @property {?object} provenanceInfo - See {@link Scoop.provenanceInfo}. Only populated if the "provenanceSummary" option was turned on.
   */

  /**
   * Generates and returns a summary of the current capture, regardless of its state.
   * @returns {Promise<ScoopCaptureSummary>}
   */
  async summary() {
    const summary = {
      state: this.state,
      states: Object.keys(Scoop.states), // So summary.states[summary.state] = 'NAME-OF-STATE'
      targetUrl: this.url,
      targetUrlResolved: this.targetUrlResolved,
      targetUrlIsWebPage: this.targetUrlIsWebPage,
      targetUrlContentType: this.targetUrlContentType,
      startedAt: this.startedAt,
      options: this.options,
      exchangeUrls: this.exchanges.map(exchange => exchange.url),
      attachments: {},
      provenanceInfo: this.options.provenanceSummary ? this.provenanceInfo : {},
      pageInfo: this.pageInfo
      // NOTE:
      // `provenanceInfo` also contains an `options` object,
      // but some of its properties have been edited because it is meant to be embedded in a WACZ.
      // (For example: Paths replaced with hashes)
      // For that reason, it is worth keeping both `options` objects,
      // because `provenanceInfo.options` is both different and contextual.
    }

    // Remove favicon from pageInfo
    if (summary.pageInfo && 'favicon' in summary.pageInfo) {
      delete summary.pageInfo.favicon
    }

    //
    // Summarize attachments
    //
    const generatedExchanges = this.extractGeneratedExchanges()

    // 1-to-1 matches:
    // - Add filename to "attachments" as key if present in generated exchanges list
    // - Example: attachments.provenanceSummary = "provenance-summary.html"
    for (const [key, filename] of Object.entries({
      provenanceSummary: 'provenance-summary.html',
      screenshot: 'screenshot.png',
      pdfSnapshot: 'pdf-snapshot.pdf',
      domSnapshot: 'dom-snapshot.html',
      videoExtractedSummary: 'video-extracted-summary.html',
      videoExtractedMetadata: 'video-extracted-metadata.json'
    })) {
      if (generatedExchanges[filename]) {
        summary.attachments[key] = filename
      }
    }

    // 1-to-many matches:
    // - Videos are added to attachments.videoExtracted[]
    // - Video subtitles are added to attachments.videoSubtitles[]
    // - SSL certs are added to attachments.certificates[]
    for (const filename of Object.keys(generatedExchanges)) {
      if (filename.endsWith('.mp4')) {
        if (!summary.attachments?.videos) {
          summary.attachments.videoExtracted = []
        }
        summary.attachments.videoExtracted.push(filename)
      }

      if (filename.endsWith('.vtt')) {
        if (!summary.attachments?.videoSubtitles) {
          summary.attachments.videoExtractedSubtitles = []
        }
        summary.attachments.videoExtractedSubtitles.push(filename)
      }

      if (filename.endsWith('.pem')) {
        if (!summary.attachments?.certificates) {
          summary.attachments.certificates = []
        }
        summary.attachments.certificates.push(filename)
      }
    }

    return summary
  }
}
