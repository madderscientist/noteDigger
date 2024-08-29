// 线程文件，利用WASM计算CQT
// import Module from "./cqt.wasm.js";  // 不知道为什么一用就报错，明明nodejs里面是可以的
// 浏览器可以直接script src引入
self.importScripts("./cqt.wasm.js");

const CQT = new Promise((resolve) => {
    Module.onRuntimeInitialized = () => {
        resolve(Module.CQT);
    };
});

self.onmessage = async ({data}) => {
    let { audioChannel, sampleRate, hop, fmin } = data;
    const cqt = new (await CQT)(sampleRate, hop, fmin, 84, 12, 2.88);
    let cqtData = cqt.cqt(audioChannel[0]);
    // 复制构造，因为WASM的内存不能transfer，原因见下
    cqtData = cqtData.map(x => new Float32Array(x));
    // 第二个通道
    if (audioChannel.length == 2) {
        cqt.clearOutput();  // 因为上面复制构造了，这里可以先清空了
        let cqtData2 = cqt.cqt(audioChannel[1]);
        for (let i = 0; i < cqtData.length; i++) {
            const temp1 = cqtData[i];
            const temp2 = cqtData2[i];
            for (let j = 0; j < cqtData[i].length; j++)
                temp1[j] = (temp1[j] + temp2[j]) * 0.5;
        }
    }
    // 第一个问题：self.postMessage(cqtData, cqtData.map(x => x.buffer));失败，因为重复transfer了一个buffer
    // 于是发现每个Float32Array.buffer都是同一个
    // 于是只传递一个buffer，但是报错Failed to execute 'postMessage' on 'DedicatedWorkerGlobalScope': ArrayBuffer at index 0 is not detachable and could not be transferred.
    // 于是试着传递Module.HEAPF32.buffer，但是报错相同
    // 所以只能复制构造了
    self.postMessage(cqtData, [...cqtData.map(x => x.buffer), ...audioChannel.map(x => x.buffer)]);
    cqt.delete();
    self.close();
};
