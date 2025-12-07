// const ort_folder = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
// self.importScripts(ort_folder + 'ort.wasm.min.js');
// ort.env.wasm.wasmPaths = ort_folder;
self.importScripts('./postprocess.js');
self.importScripts('./SpectralClustering.js');
self.importScripts('./dist/bundle.min.js')
ort.env.wasm.wasmPaths = './dist/'

const model = ort.InferenceSession.create(
    './septimbre_44100.onnx',
    { executionProviders: ['wasm'] }
);

self.onmessage = function ({data}) {
    if (typeof data === 'number') {
        // 接收到的是k
        self.k = data;
        return;
    }
    const tensorInput = new ort.Tensor('float32', data, [1, 1, data.length]);
    model.then((m) => {
        return m.run({ audio: tensorInput });
    }).then((results) => {
        const note_events = createNotes(
            results.onset, results.frame,
            0.31, 0.35
        );
        console.time('clusterNotes');
        const clustered_notes = clusterNotes(
            note_events,
            results.embedding,
            results.frame,
            self.k || 2
        );
        console.timeEnd('clusterNotes');
        self.postMessage(clustered_notes);
    }).catch((e) => {
        // promise中的报错不会触发worker.onerror回调，即使这里throw了。所以只能用onmessage
        self.postMessage({ type: 'error', message: e.message });
    });
};


function clusterNotes(note_events, embTensor, frameTensor, k=2) {
    // 模型中已经对onset和frame进行归一化了
    const raw_frameData = frameTensor.cpuData;
    const frameDim = frameTensor.dims;  // [1, 84, frames]
    const raw_embData = embTensor.cpuData;
    const embDim = embTensor.dims;  // [1, 12, 84, frames]

    const frameNum = frameDim[2];
    const noteNum = frameDim[1];

    const frameData = Array(noteNum);
    for (let i = 0; i < noteNum; i++) {
        // 和raw共享内存
        frameData[i] = new Float32Array(raw_frameData.buffer, i * frameNum * 4, frameNum);
    }

    const spaceSize = noteNum * frameNum;
    function getEmbedding(note, time, emb) {
        // embDim: [1, 12, 84, frames]
        // raw_embData: Float32Array
        for (let i = 0; i < embDim[1]; i++) {
            // 计算在一维数组中的索引
            // 索引 = i * noteNum * frameNum + note * frameNum + time
            emb[i] = raw_embData[
                i * spaceSize + note * frameNum + time
            ];
        }
        return emb;
    }

    const embeddings = [];
    const buffer = new Float32Array(embDim[1]);
    for (const note_event of note_events) {
        const { onset, offset, note } = note_event;
        const emb = new Float32Array(embDim[1]);
        // 取音符中间的embedding
        for (let t = onset; t < offset; t++) {
            const e = getEmbedding(note - 24, t, buffer);
            const frame = frameData[note - 24][t];
            const w = frame * frame;  // 用frame的值作为权重
            for (let i = 0; i < embDim[1]; i++) {
                emb[i] += e[i] * w;
            }
        }
        let norm = 0.0;
        for (let i = 0; i < embDim[1]; i++) norm += emb[i] * emb[i];
        norm = Math.sqrt(norm);
        for (let i = 0; i < embDim[1]; i++) emb[i] /= norm;
        embeddings.push(emb);
    }

    const labels = SpectralClustering(embeddings, k);
    const clustered_notes = Array.from({ length: k }, () => []);
    for (let i = 0; i < note_events.length; i++) {
        clustered_notes[labels[i]].push(note_events[i]);
    }
    return clustered_notes;
}