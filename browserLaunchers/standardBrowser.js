
import { AbstractBrowser } from './abstractBrowser.js'
import  { chromium }  from 'playwright';

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
    return chromium.launch(options)
  }
}
