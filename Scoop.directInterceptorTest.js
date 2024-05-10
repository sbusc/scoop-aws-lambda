import fs from 'fs/promises'
import { Scoop } from './Scoop.js'

try {
  console.log("Simple test started ...")
  const capture = await Scoop.capture('https://soenke-busch.de', {
    screenshot: true,
    pdfSnapshot: true,
    captureVideoAsAttachment: false,
    captureTimeout: 120 * 1000,
    loadTimeout: 60 * 1000,
    captureWindowX: 320,
    captureWindowY: 480,
    intercepter: "DirectIntercepter",
    browser: "StandardBrowser" // for AWS Lambda, use "AwsLambdaBrowser"
  })

  const warc = await capture.toWARC()
  await fs.writeFile('archive.warc', Buffer.from(warc))
} catch (err) {
    console.error('Error on top level:', err);
}
