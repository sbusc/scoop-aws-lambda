
import { AbstractBrowser } from './abstractBrowser.js'

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
    const { chromium } = await import('playwright');
    return chromium.launch(options)
  }
}
