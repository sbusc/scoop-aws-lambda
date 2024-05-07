
import { Scoop } from '../Scoop.js'
/**
 * @class AbstractBrowser
 * @abstract
 *
 * @classdesc
 * Abstract class for launching browsers.
 *
 */
export class AbstractBrowser {
  /**
   * @param {Scoop} capture
   */
  constructor (capture) {
    if (capture instanceof Scoop === false) {
      throw new Error('"capture" must be an instance of Scoop.')
    }

    this.capture = capture
    return this
  }

  /**
   * The Scoop capture utilizing this intercepter
   *
   * @type {Scoop}
   */
  capture
  
 async launchBrowser (options) {
        throw new Error('Method must be implemented.')
}
}
