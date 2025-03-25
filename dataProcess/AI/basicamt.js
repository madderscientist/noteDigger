function basicamt(audioChannel) {
    let timeDomain = new Float32Array(audioChannel.getChannelData(0));
    let audioLen = timeDomain.length;
    // 求和。不求平均是因为模型内部有归一化
    if (audioChannel.numberOfChannels !== 1) {
        for (let i = 1; i < audioChannel.numberOfChannels; i++) {
            const channelData = audioChannel.getChannelData(i);
            for (let j = 0; j < audioLen; j++) timeDomain[j] += channelData[j];
        }
    }
    return new Promise((resolve, reject) => {
        const basicamtWorker = new Worker("./dataProcess/AI/basicamt_worker.js");
        basicamtWorker.onmessage = ({data}) => {
            if (data.type === 'error') {
                console.error(data.message);
                reject("疑似因为音频过长导致内存不足！");
                basicamtWorker.terminate();
            }
            resolve(data);  // 返回的是音符事件
            basicamtWorker.terminate();
        };
        basicamtWorker.onerror = (e) => {
            console.error(e.message);
            reject(e);
            basicamtWorker.terminate();
        };
        basicamtWorker.postMessage(timeDomain, [timeDomain.buffer]);
    });
}