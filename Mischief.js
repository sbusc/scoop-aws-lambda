/**
 * Mischief
 * @module Mischief
 * @author The Harvard Library Innovation Lab
 * @license MIT
 */
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import { spawnSync } from "child_process";

import { chromium } from "playwright";
import nunjucks from "nunjucks";

import { MischiefExchange, MischiefGeneratedExchange } from "./exchanges/index.js";
import { MischiefLog } from "./MischiefLog.js";
import { MischiefOptions } from "./MischiefOptions.js";

import * as intercepters from "./intercepters/index.js";
import * as exporters from "./exporters/index.js";

/**
 * Path to "tmp" folder. 
 * @constant
 */
export const TMP_DIR = `./tmp/`;

/**
 * Path to "assets" folder. 
 * @constant
 */
export const ASSETS_DIR = `./assets/`;

/**
 * Experimental single-page web archiving library using Playwright.
 * Uses a proxy to allow for comprehensive and raw network interception.
 * 
 * Usage:
 * ```javascript
 * import { Mischief } from "mischief";
 * 
 * const myCapture = new Mischief("https://example.com");
 * await myCapture.capture();
 * const myArchive = await myCapture.toWarc();
 * ```
 */
export class Mischief {
  id = uuidv4();

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
    FAILED: 5
  };

  /**
   * Current state of the capture.
   * Should only contain states defined in `states`.
   * @type {number}
   */
  state = Mischief.states.INIT;

  /**
   * URL to capture.
   * @type {string} 
   */
  url = "";

  /** 
   * Current settings. 
   * Should only contain keys defined in `MischiefOptions`.
   * @type {object} 
   */
  options = {};

  /**
   * Array of HTTP exchanges that constitute the capture.
   * @type {MischiefExchange[]}
   */
  exchanges = [];

  /**
   * Keeps track of exchanges that were generated during capture.
   * Example: `file:///screenshot.png` for the full-page screenshot.
   * 
   * @type {MischiefGeneratedExchange[]}
   */
  generatedExchanges = [];

  /** @type {MischiefLog[]} */
  logs = [];

  /**
   * The time at which the page was crawled.
   * @type {Date}
   */
  startedAt;

  /**
   * The Playwright browser instance for this capture.
   * @type {Browser}
   */
  #browser;

  /**
   * Reference to the intercepter chosen for capture.
   * @type {intercepters.MischiefIntercepter}
   */
  intercepter;

  /**
   * @param {string} url - Must be a valid HTTP(S) url.
   * @param {object} [options={}] - See `MischiefOptions.defaults` for details.
   */
  constructor(url, options = {}) {
    this.url = this.filterUrl(url);
    this.options = MischiefOptions.filterOptions(options);
    this.intercepter = new intercepters[this.options.intercepter](this);
  }

  /**
   * Main capture process.
   *   
   * @returns {Promise<boolean>}
   */
  async capture() {
    const options = this.options;
    const steps = [];

    //
    // Prepare capture steps
    //

    // Push step: Setup interceptor
    steps.push({
      name: "intercepter",
      main: async (page) => {
        await this.intercepter.setup(page);
      }
    })

    // Push step: Initial page load
    steps.push({
      name: "initial load",
      main: async (page) => {
        await page.goto(this.url, { waitUntil: "load", timeout: options.loadTimeout });
      }
    });

    // Push step: Browser scripts
    if (
      options.grabSecondaryResources ||
      options.autoPlayMedia ||
      options.runSiteSpecificBehaviors ||
      options.autoScroll
    ) {
      steps.push({
        name: "browser scripts",
        setup: async (page) => {
          await page.addInitScript({
            path: "./node_modules/browsertrix-behaviors/dist/behaviors.js",
          });
          await page.addInitScript({
            content: `
              self.__bx_behaviors.init({
                autofetch: ${options.grabSecondaryResources},
                autoplay: ${options.autoPlayMedia},
                autoscroll: ${options.autoScroll},
                siteSpecific: ${options.runSiteSpecificBehaviors},
                timeout: ${options.behaviorsTimeout}
              });`,
          });
        },
        main: async (page) => {
          await Promise.allSettled(
            page.frames().map((frame) => frame.evaluate("self.__bx_behaviors.run()"))
          );
        },
      });
    }

    // Push step: Wait for network idle
    steps.push({
      name: "network idle",
      main: async (page) => {
        await page.waitForLoadState("networkidle", {timeout: options.networkIdleTimeout});
      }
    });

    // Push step: Screenshot
    if (options.screenshot) {
      steps.push({
        name: "screenshot",
        main: async (page) => {
          const url = "file:///screenshot.png";
          const httpHeaders = { "Content-Type": "image/png" };
          const body = await page.screenshot({ fullPage: true });
          const isEntryPoint = true;
          const description = `Capture Time Screenshot of ${this.url}`;
          this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint, description);
        }
      });
    }

    // Push step: DOM Snapshot
    if (options.domSnapshot) {
      steps.push({
        name: "DOM snapshot",
        main: async (page) => {
          const url = "file:///dom-snapshot.html";
          const httpHeaders = {
            "Content-Type": "text/html",
            "Content-Disposition": "Attachment",
          };
          const body = Buffer.from(await page.content());
          const isEntryPoint = true;
          const description = `Capture Time DOM Snapshot of ${this.url}`;

          this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint, description);
        }
      });
    }

    // Push step: PDF Snapshot
    if (options.pdfSnapshot) {

      steps.push({
        name: "PDF snapshot",
        main: async (page) => {
          await page.emulateMedia({media: 'screen'});

          // Generate PDF
          const dimensions = await page.evaluate(() =>  {
            const width = Math.max(document.body.scrollWidth, window.outerWidth);
            const height = Math.max(document.body.scrollHeight, window.outerHeight) + 50;
            return {width, height};
          });

          let pdf = await page.pdf({
            printBackground: true,
            width: dimensions.width,
            height: dimensions.height
          });

          // Try to apply compression if Ghostscript is available
          const tmpFilenameIn = `${TMP_DIR}${this.id}-raw.pdf`;
          const tmpFilenameOut = `${TMP_DIR}${this.id}-compressed.pdf`
          try {
            fs.writeFileSync(tmpFilenameIn, pdf);

            spawnSync("gs", [
              "-sDEVICE=pdfwrite",
              "-dNOPAUSE",
              "-dBATCH",
              "-dJPEGQ=90",
              "-r150",
              `-sOutputFile=${tmpFilenameOut}`,
              `${tmpFilenameIn}`,
            ]);

            pdf = fs.readFileSync(tmpFilenameOut);
          }
          catch(err) {
            this.addToLogs("gs command (Ghostscript) is not available. The PDF Snapshot will be stored uncompressed.", true, err);
          }
          finally {
            fs.unlink(tmpFilenameIn, () => {});
            fs.unlink(tmpFilenameOut, () => {});
          }

          const url = "file:///pdf-snapshot.pdf";
          const httpHeaders = {"Content-Type": "application/pdf"};
          const body = pdf;
          const isEntryPoint = true;
          const description = `Capture Time PDF Snapshot of ${this.url}`;

          this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint, description);
        }
      });
    }

    // Push step: Capture of in-page videos as attachment
    if (options.captureVideoAsAttachment) {
      steps.push({
        name: "out-of-browser capture of video as attachment",
        main: async () => {
          await this.#captureVideoAsAttachment();
        }
      });
    }

    // Push step: Teardown
    steps.push({
      name: "teardown",
      main: async () => {
        this.state = Mischief.states.COMPLETE;
        await this.teardown();
      }
    });

    //
    // Initialize capture
    //
    let page;
    try {
      page = await this.setup();
      this.addToLogs(`Starting capture of ${this.url} with options: ${JSON.stringify(options)}`);
      this.state = Mischief.states.CAPTURE;
    } 
    catch (e) {
      this.addToLogs("An error ocurred during capture setup", true, e);
      this.state = Mischief.states.FAILED;
      return; // exit early if the browser and proxy couldn't be launched
    }

    // Call `setup()` method of steps that have one
    for (const step of steps.filter((step) => step.setup)) {
      await step.setup(page);
    }

    //
    // Run capture steps
    //
    let i = -1;
    while(i++ < steps.length-1 && this.state == Mischief.states.CAPTURE) {
      const step = steps[i];
      try {
        this.addToLogs(`STEP [${i+1}/${steps.length}]: ${step.name}`);
        await step.main(page);
      } 
      catch(err) {
        if(this.state == Mischief.states.CAPTURE){
          this.addToLogs(`STEP [${i+1}/${steps.length}]: ${step.name} - failed`, true, err);
        } 
        else {
          this.addToLogs(`STEP [${i+1}/${steps.length}]: ${step.name} - ended due to max time or size reached`, true);
        }
      }
    }
  }

  /**
   * Sets up the proxy and Playwright resources
   *
   * @returns {Promise<boolean>}
   */
  async setup() {
    this.startedAt = new Date();
    this.state = Mischief.states.SETUP;
    const options = this.options;
    const userAgent = (await this.getDefaultUserAgent()) + options.userAgentSuffix;

    this.addToLogs(`User Agent used for capture: ${userAgent}`);

    this.#browser = await chromium.launch({
      headless: options.headless,
      channel: "chrome"
    })

    const context = await this.#browser.newContext({ 
      ...this.intercepter.contextOptions, 
      userAgent
    });

    const page = await context.newPage();

    page.setViewportSize({
      width: options.captureWindowX,
      height: options.captureWindowY,
    });

    const totalTimeoutTimer = setTimeout(() => {
      this.addToLogs(`totalTimeout of ${options.totalTimeout}ms reached. Ending further capture.`);
      this.state = Mischief.states.PARTIAL;
      this.teardown();
    }, options.totalTimeout);

    this.#browser.on('disconnected', () => {
      clearTimeout(totalTimeoutTimer);
    });

    return page;
  }

  /**
   * Tears down Playwright and intercepter resources.
   * @returns {Promise<boolean>}
   */
  async teardown() {
    this.addToLogs("Closing browser and intercepter.");
    await this.intercepter.teardown();
    await this.#browser.close();
    this.exchanges = this.intercepter.exchanges.concat(this.exchanges);
  }

  /**
   * Runs `yt-dlp` on the current url to try and capture:
   * - The "main" video of the current page (`file:///video-extracted.mp4`)
   * - Associated subtitles (`file:///video-extracted-LOCALE.EXT`)
   * - Associated meta data (`file:///video-extracted-metadata.json`)
   * 
   * These elements are added as "attachments" to the archive, for context / playback fallback purposes. 
   * A summary file and entry point, `file:///video-extracted-summary.html`, will be generated in the process.
   * 
   * @private
   */
  async #captureVideoAsAttachment() {
    const id = this.id;
    const videoFilename = `${TMP_DIR}${id}.mp4`;
    const dlpExecutable = `./node_modules/yt-dlp/yt-dlp`;

    let metadataRaw = null;
    let metadataParsed = null;

    const subtitlesAvailableLocales = [];
    let subtitlesFormat = 'vtt';
    let videoSaved = false;
    let metadataSaved = false;
    let subtitlesSaved = false;

    //
    // yt-dlp health check
    //
    try {
      const result = spawnSync(dlpExecutable, ["--version"], {encoding: "utf8"});

      if (result.status !== 0) {
        throw new Error(result.stderr);
      }

      const version = result.stdout.trim();

      if (!version.match(/^[0-9]{4}\.[0-9]{2}\.[0-9]{2}$/)) {
        throw new Error(`Unknown version: ${version}`);
      }
    }
    catch(err) {
      throw new Error(`"yt-dlp" executable is not available or cannot be executed. ${err}`);
    }

    //
    // Try and pull video and video meta data from url
    //
    try {
      const dlpOptions = [
        "--dump-json", // Will return JSON meta data via stdout
        "--no-simulate", // Forces download despites `--dump-json`
        "--no-warnings", // Prevents pollution of stdout
        "--no-progress", // (Same as above)
        "--write-subs", // Try to pull subs
        "--sub-langs", "all", 
        "--format", "mp4", // Forces .mp4 format
        "--output", videoFilename,
        this.url
      ];

      const spawnOptions = {
        timeout: this.options.captureVideoAsAttachmentTimeout,
        encoding: "utf8",
      };

      const result = spawnSync(dlpExecutable, dlpOptions, spawnOptions);

      if (result.status !== 0) {
        throw new Error(result.stderr);
      }

      metadataRaw = result.stdout;
    }
    catch(err) {
      throw new Error(`No video found in ${this.url}.`); 
    }

    //
    // Try to add video to exchanges
    //
    try {
      const url = "file:///video-extracted.mp4";
      const httpHeaders = { "Content-Type": "video/mp4" };
      const body = fs.readFileSync(videoFilename);
      const isEntryPoint = false; // TODO: Reconsider whether this should be an entry point.

      this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint);
      videoSaved = true;
    }
    catch(err) {
      throw new Error(`Error while creating exchange for file:///video-extracted.mp4. ${err}`);
    }
    // Clean up .mp4 file for this capture.
    finally {
      if (fs.existsSync(videoFilename)) {
        fs.unlinkSync(videoFilename);
      }
    }

    //
    // Try to add metadata to exchanges
    //
    try {
      metadataParsed = JSON.parse(metadataRaw); // May throw

      const url = "file:///video-extracted-metadata.json";
      const httpHeaders = { "Content-Type": "application/json" };
      const body = Buffer.from(JSON.stringify(metadataParsed, null, 2));
      const isEntryPoint = false;

      this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint);
      metadataSaved = true;
    }
    catch(err) {
      throw new Error(`Error while creating exchange for file:///video-extracted-medatadata.json. ${err}`);
    }

    //
    // Pull subtitles, if any.
    //
    try {
      for (let file of fs.readdirSync(TMP_DIR)) {

        if (!file.startsWith(id)) {
          continue;
        }
        
        if (!file.endsWith(".vtt") && !file.endsWith(".srt")) {
          continue;
        }
  
        let locale = null;
        subtitlesFormat = "vtt";
        [, locale, subtitlesFormat] = file.split(".");

        // Example of valid locales: "en", "en-US"
        if (!locale.match(/^[a-z]{2}$/) && !locale.match(/[a-z]{2}\-[A-Z]{2}/)) {
          continue;
        }

        const url = `file:///video-extracted-subtitles-${locale}.${subtitlesFormat}`;
        const httpHeaders = { 
          "Content-Type": subtitlesFormat === "vtt" ? "text/vtt" : "text/plain"
        };
        const body = fs.readFileSync(`${TMP_DIR}${file}`);
        const isEntryPoint = false;

        this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint);
        subtitlesAvailableLocales.push(locale); // Keep track of available locales
        subtitlesSaved = true;
      }
    }
    catch(err) {
      // Ignore subtitles-related errors.
      //console.log(err);
    }

    //
    // Clean up files generated for this capture.
    //
    for (let file of fs.readdirSync(TMP_DIR)) {
      if (file.startsWith(id)) {
        fs.unlinkSync(`${TMP_DIR}${file}`);
      }
    }

    //
    // Generate summary page
    //
    try {
      const html = nunjucks.render(`${ASSETS_DIR}video-extracted-summary.njk`, {
        url: this.url,
        now: new Date().toISOString(),
        videoSaved,
        metadataSaved,
        subtitlesSaved,
        subtitlesAvailableLocales,
        subtitlesFormat,
        metadataParsed,
      });

      const url = `file:///video-extracted-summary.html`;
      const httpHeaders = { "Content-Type": "text/html" };
      const body = Buffer.from(html);
      const isEntryPoint = true;
      const description = `Extracted Video from: ${this.url}`;

      this.addGeneratedExchange(url, httpHeaders, body, isEntryPoint, description);
    }
    catch(err) {
      throw new Error(`Error while creating exchange for file:///video-extracted-summary.html. ${err}`);
    }
  }

  /**
   * Generates a MischiefGeneratedExchange for generated content and adds it to `exchanges` and `generatedExchanges` unless time limit was reached.
   * @param {string} url 
   * @param {object} httpHeaders 
   * @param {Buffer} body 
   * @param {boolean} isEntryPoint
   * @param {string} description 
   * @returns 
   */
  async addGeneratedExchange(url, httpHeaders, body, isEntryPoint = false, description = "") {
    let canBeAdded = true;
    let remainingSpace = this.options.maxSize - this.intercepter.byteLength;

    if(this.state != Mischief.states.CAPTURE) {
      canBeAdded = false;
    }

    if (body.byteLength >= remainingSpace) {
      canBeAdded = false;
    }

    if (canBeAdded === false) {
      this.state = Mischief.states.PARTIAL;
      this.addToLogs(`Generated exchange ${url} could not be saved (size limit reached).`);
      return;
    }

    const exchange = new MischiefGeneratedExchange({
      description: description,
      isEntryPoint: Boolean(isEntryPoint),
      response: {
        url: url,
        headers: httpHeaders,
        versionMajor: 1,
        versionMinor: 1,
        statusCode: 200,
        statusMessage: "OK",
        body: body,
      },
    });

    this.exchanges.push(exchange);
    this.generatedExchanges.push(exchange);
  }

  /**
   * Creates and stores a log entry.
   * Will automatically be printed to STDOUT if `this.options.verbose` is `true`.
   * 
   * @param {string} message 
   * @param {boolean} [isWarning=false] 
   * @param {string} [trace=""] 
   */
  addToLogs(message, isWarning = false, trace = "") {
    const log = new MischiefLog(message, isWarning, trace, this.options.verbose);
    this.logs.push(log);
  }

  /**
   * Filters a url to ensure it's suitable for capture.
   * This function throws if:
   * - `url` is not a valid url
   * - `url` is not an http / https url
   * 
   * @param {string} url 
   */
  filterUrl(url) {
    try {
      const filteredUrl = new URL(url); // Will throw if not a valid url

      if (filteredUrl.protocol !== "https:" && filteredUrl.protocol !== "http:") {
        throw new Error("Invalid protocol.");
      }
      
      return filteredUrl.href;
    }
    catch(err) {
      throw new Error(`Invalid url provided.\n${err}`);
    }
  }

  /**
   * Spins up a temporary browser to extract and return the default user agent.
   * @return {string}
   */
  async getDefaultUserAgent() {
    const browser = await chromium.launch({headless: true, channel: "chrome"});
    const page = await browser.newPage();

    const userAgent = await page.evaluate(() => window.navigator.userAgent);

    await page.close();
    await browser.close();
    
    return userAgent;
  }
  
  /**
   * (Shortcut) Export this Mischief capture to WARC.
   * @returns {Promise<ArrayBuffer>}
   */
  async toWarc() {
    return await exporters.mischiefToWarc(this);
  }

  /**
   * (Shortcut) Export this Mischief capture to WACZ.
   * @param {boolean} [includeRaw=true] - Include a copy of RAW Http exchanges to the wacz (under `/raw`)?
   * @returns {Promise<ArrayBuffer>}
   */
  async toWacz(includeRaw=true) {
    return await exporters.mischiefToWacz(this, includeRaw);
  }
}
