import fs from 'fs';

export async function writeAllExchangesToFile(exchanges, path) {
    // Create a writable stream to the file
    const stream = fs.createWriteStream(path, { flags: 'w' });
    stream.write(`"url"; "response"; "startLine"; "bodyLength"\n`);

    for (const ex of exchanges) {
        // console.log(ex.url)
        stream.write(`"` + ex.url + `"`);

        if (!ex.response)
            stream.write(`; "NO"`)
        else {
            const response = ex.response
            stream.write(`; "YES"`)
            stream.write(`; "` + response.startLine + `"`)
            let bodyLen = 0;
            try {
                let body = response.body
                bodyLen = body.length
            }
            catch (e) {
                bodyLen = -1
            }
            stream.write(`; "` + bodyLen + `"`)
        }


        stream.write('\n');
    }
    // Close the stream
    stream.end();
}