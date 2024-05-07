
import { AbstractBrowser } from './abstractBrowser.js'
import  { chromium as playwright }  from 'playwright-core';
import chromium from '@sparticuz/chromium';
/**
 * @class AwsLambdaBrowser
 * @extends AbstractBrowser
 *
 * @classdesc
 * Abstract class for launching browsers.
 *
 */
export class AwsLambdaBrowser extends AbstractBrowser {
    async launchBrowser(options) {

        let opt = options || {}
        opt.args = chromium.args;
        opt.executablePath = await chromium.executablePath();
        opt.headless = true;

        return await playwright.launch(opt)
    }
}
