// 开启CQT的Worker线程，因为CQT是耗时操作，所以放在Worker线程中
function cqt(audioBuffer, tNum, channel, fmin) {
    var audioChannel;
    switch (channel) {
        case 0: audioChannel = [audioBuffer.getChannelData(0)]; break;
        case 1: audioChannel = [audioBuffer.getChannelData(audioBuffer.numberOfChannels - 1)]; break;
        case 2: {   // L+R
            let length = audioBuffer.length;
            const timeDomain = new Float32Array(audioBuffer.getChannelData(0));
            if (audioBuffer.numberOfChannels > 1) {
                let channelData = audioBuffer.getChannelData(1);
                for (let i = 0; i < length; i++) timeDomain[i] = (timeDomain[i] + channelData[i]) * 0.5;
            } audioChannel = [timeDomain]; break;
        }
        case 3: {   // L-R
            let length = audioBuffer.length;
            const timeDomain = new Float32Array(audioBuffer.getChannelData(0));
            if (audioBuffer.numberOfChannels > 1) {
                let channelData = audioBuffer.getChannelData(1);
                for (let i = 0; i < length; i++) timeDomain[i] = (timeDomain[i] - channelData[i]) * 0.5;
            } audioChannel = [timeDomain]; break;
        }
        default: {  // cqt(L) + cqt(R)
            if (audioBuffer.numberOfChannels > 1) {
                audioChannel = [audioBuffer.getChannelData(0), audioBuffer.getChannelData(1)];
            } else {
                audioChannel = [audioBuffer.getChannelData(0)];
            } break;
        }
    }
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
            audioChannel: audioChannel,
            sampleRate: audioBuffer.sampleRate,
            hop: Math.round(audioBuffer.sampleRate / tNum),
            fmin: fmin,
        }, audioChannel.map(x => x.buffer));
    });
}