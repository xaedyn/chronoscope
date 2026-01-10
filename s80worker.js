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
    const url = event.data.url || 'reqspeed.jpg';
    let startTime = performance.now();
    fetchWithTimeout(url)
        .then(measureResponse)
        .then(() => {
            let completeTime = performance.now();
            if (completeTime - startTime <= 0) {
                console.log("error: Impossibly short request (likely caused by Spectre mitigation in your browser reducing timer accuracy)");
                console.log("completeTime: " + completeTime);
                console.log("startTime: " + startTime);
                postMessage({ time: 1, error: false });
            }
            else {
                postMessage({ time: Math.ceil(completeTime - startTime), error: false });
            }
        })
        .catch(err => {
            let completeTime = performance.now();
            if (err.message === 'timeout') {
                postMessage({ time: 7000, error: true, message: 'timeout' });
            } else {
                // Network errors still give us timing info
                postMessage({ time: Math.ceil(completeTime - startTime), error: true, message: err.message });
            }
        });
};
