function fetchWithTimeout(url, timeout = 7000) {
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
        startTime = performance.now();
        fetchWithTimeout(url)
            .then(measureResponse)
            .then(() => {
                let completeTime = performance.now();
                if (completeTime - startTime <= 0) {
                    postMessage({ time: 1, error: false });
                }
                else {
                    postMessage({ time: Math.ceil(completeTime - startTime), error: false });
                }
            })
            .catch(err => {
                let completeTime = performance.now();
                if (err && err.message === 'timeout') {
                    postMessage({ time: 7000, error: true, message: 'timeout' });
                } else {
                    postMessage({ time: Math.ceil(completeTime - startTime), error: true, message: err ? err.message : 'unknown' });
                }
            });
    } catch (e) {
        // Catch any synchronous errors
        postMessage({ time: 0, error: true, message: e ? e.message : 'sync error' });
    }
};
