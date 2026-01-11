function fetchWithTimeout(url, timeout) {
    let options = {
        cache: "no-store",
        mode: "no-cors"
    };
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), timeout)
        )
    ]);
}

function measureResponse(myRes) {
    // With no-cors, response.ok will be false and type will be "opaque"
    // We still get timing data even though we can't read the response
    return myRes;
}

self.onmessage = function (event) {
    let startTime;
    try {
        const url = event.data.url || 'reqspeed.jpg';
        const timeout = event.data.timeout || 2000;
        startTime = performance.now();
        fetchWithTimeout(url, timeout)
            .then(measureResponse)
            .then(() => {
                let completeTime = performance.now();
                if (completeTime - startTime <= 0) {
                    postMessage({ time: 1, error: false, timeout: false });
                }
                else {
                    postMessage({ time: Math.ceil(completeTime - startTime), error: false, timeout: false });
                }
            })
            .catch(err => {
                let completeTime = performance.now();
                if (err && err.message === 'timeout') {
                    postMessage({ time: timeout, error: true, timeout: true, message: 'timeout' });
                } else {
                    postMessage({ time: Math.ceil(completeTime - startTime), error: true, timeout: false, message: err ? err.message : 'unknown' });
                }
            });
    } catch (e) {
        // Catch any synchronous errors
        postMessage({ time: 0, error: true, timeout: false, message: e ? e.message : 'sync error' });
    }
};
