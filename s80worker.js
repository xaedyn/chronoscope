self.onmessage = function (event) {
    const url = event.data.url || 'reqspeed.jpg';
    const timeout = event.data.timeout || 2000;
    const startTime = performance.now();

    let done = false;

    fetch(url, { cache: "no-store", mode: "no-cors" })
        .then(() => {
            if (done) return;
            const elapsed = Math.ceil(performance.now() - startTime);
            // Only count as success if it completed before timeout
            // (requests completing at or after timeout are handled by timeout handler)
            if (elapsed < timeout) {
                done = true;
                postMessage({ time: Math.max(1, elapsed), error: false, timeout: false });
            }
        })
        .catch((err) => {
            if (done) return;
            done = true;
            // Report as error - not a data point, not a timeout
            postMessage({ time: 0, error: true, timeout: false, errorMsg: err.message || 'Network error' });
        });

    // Timeout handler - only fires if fetch didn't complete or error yet
    setTimeout(() => {
        if (!done) {
            done = true;
            postMessage({ time: timeout, error: false, timeout: true });
        }
    }, timeout);
};
