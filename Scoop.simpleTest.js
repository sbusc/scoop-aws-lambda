import fs from 'fs/promises'
import { Scoop } from './Scoop.js'

try {
  const capture = await Scoop.capture('https://handelsblatt.com', {
    screenshot: true,
    pdfSnapshot: true,
    captureVideoAsAttachment: false,
    captureTimeout: 120 * 1000,
    loadTimeout: 60 * 1000,
    captureWindowX: 320,
    captureWindowY: 480
  })

  const warc = await capture.toWARC()
  await fs.writeFile('archive.warc', Buffer.from(warc))
} catch (err) {
  // ...
}
