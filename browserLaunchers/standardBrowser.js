
import { AbstractBrowser } from './abstractBrowser.js'
import * as playwright from 'playwright-aws-lambda'
/**
 * @class StandardBrowser
 * @extends AbstractBrowser
 *
 * @classdesc
 * Abstract class for launching browsers.
 *
 */
export class StandardBrowser extends AbstractBrowser {
   async launchBrowser(options) {
    return playwright.launchChromium(options)
  }
}
