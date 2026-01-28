var AI = {
combineChannels: (audioChannel) => {
    const wav = new Float32Array(audioChannel.getChannelData(0));
    // 求和。不求平均是因为模型内部有归一化
    if (audioChannel.numberOfChannels !== 1) {
        const len = wav.length;
        for (let i = 1; i < audioChannel.numberOfChannels; i++) {
            const cData = audioChannel.getChannelData(i);
            for (let j = 0; j < len; j++) wav[j] += cData[j];
        }
    } return wav;
},
basicamt: (audioChannel) => {
    const timeDomain = AI.combineChannels(audioChannel);
    return new Promise((resolve, reject) => {
        const basicamtWorker = new Worker("./dataProcess/AI/basicamt_worker.js");
        basicamtWorker.onmessage = ({data}) => {
            if (data.type === 'error') {
                console.error(data.message);
                reject("疑似因为音频过长导致内存不足！");
                basicamtWorker.terminate();
            } resolve(data);  // 返回的是音符事件
            basicamtWorker.terminate();
        };
        basicamtWorker.onerror = (e) => {
            console.error(e.message);
            reject(e);
            basicamtWorker.terminate();
        };
        basicamtWorker.postMessage(timeDomain, [timeDomain.buffer]);
    });
},
septimbre: (audioChannel, k) => {
    const timeDomain = AI.combineChannels(audioChannel);
    return new Promise((resolve, reject) => {
        const septimbreWorker = new Worker("./dataProcess/AI/septimbre_worker.js");
        septimbreWorker.onmessage = ({data}) => {
            if (data.type === 'error') {
                console.error(data.message);
                reject("疑似因为音频过长导致内存不足！");
                septimbreWorker.terminate();
            } resolve(data);
            septimbreWorker.terminate();
        };
        septimbreWorker.onerror = (e) => {
            console.error(e.message);
            reject(e);
            septimbreWorker.terminate();
        };
        septimbreWorker.postMessage(k);
        septimbreWorker.postMessage(timeDomain, [timeDomain.buffer]);
    });
}
};