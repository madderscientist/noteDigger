// 开启CQT的Worker线程，因为CQT是耗时操作，所以放在Worker线程中
function cqt(channels, tNum, fmin, useGPU = false) {
    return new Promise((resolve, reject) => {
        const worker = new Worker("./dataProcess/CQT/cqt_worker.js");
        worker.onerror = (e) => {
            reject(e);
            worker.terminate();
        };
        worker.onmessage = ({ data }) => {
            resolve(data);
            worker.terminate();
        };
        worker.postMessage({
            audioChannel: channels,
            sampleRate: channels.sampleRate,
            hop: Math.round(channels.sampleRate / tNum),
            fmin,
            useGPU
        }, channels.map(x => x.buffer));
    });
}