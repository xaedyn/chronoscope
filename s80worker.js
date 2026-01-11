self.onmessage = function (event) {
    const url = event.data.url || 'reqspeed.jpg';
    const timeout = event.data.timeout || 2000;
    const startTime = performance.now();

    let succeeded = false;

    fetch(url, { cache: "no-store", mode: "no-cors" })
        .then(() => {
            const elapsed = Math.ceil(performance.now() - startTime);
            // Only count as success if it completed before timeout
            if (!succeeded && elapsed < timeout) {
                succeeded = true;
                postMessage({ time: elapsed > 0 ? elapsed : 1, error: false, timeout: false });
            }
        })
        .catch(() => {
            // Fetch failed - timeout handler will report it
        });

    // Always schedule timeout - reports failure if fetch didn't succeed in time
    setTimeout(() => {
        if (!succeeded) {
            succeeded = true; // Prevent late fetch success from firing
            postMessage({ time: timeout, error: true, timeout: true });
        }
    }, timeout);
};
