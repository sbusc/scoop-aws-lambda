import fs from 'fs/promises'
import { Scoop } from './Scoop.js'

let attesterOptions = {
  attesterType: 'standard',
  timestampProof: 'chainId=0&12345',
  forwardProxy: { 
    host: 'localhost', 
    port: 8080, 
    auth: {
        type: 'bearer',
        token: 'c4fbc9216be6e32e015000348a73ecfa5431e76110c320a48897be03d7cabaf8a4fa9232a69e4a05c85170422792a8ecb07c6b2cccb66d1aae5780ff69610fcd'
    }    
}
}

try {
  const capture = await Scoop.capture('https://soenke-busch.de', {
    logLevel: 'trace',  
    screenshot: true,
    pdfSnapshot: true,
    captureVideoAsAttachment: false,
    captureTimeout: 120 * 1000,
    loadTimeout: 60 * 1000,
    captureWindowX: 320,
    captureWindowY: 480,
    intercepter: 'AttesterProxy',
    browser: "StandardBrowser" // for AWS Lambda, use "AwsLambdaBrowser"
  }, attesterOptions)
  if(capture.state !== Scoop.states.COMPLETE) {
    throw new Error('Capture is not complete, state is ' + capture.state)
  }
  const warc = await capture.toWARC()
  await fs.writeFile('archive.warc', Buffer.from(warc))
} catch (err) {
    console.error('Error on top level:', err);
}
