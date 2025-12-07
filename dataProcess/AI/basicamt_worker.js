// const ort_folder = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
// self.importScripts(ort_folder + 'ort.wasm.min.js');
// ort.env.wasm.wasmPaths = ort_folder;
self.importScripts('./postprocess.js');
self.importScripts('./dist/bundle.min.js')
ort.env.wasm.wasmPaths = './dist/'

const model = ort.InferenceSession.create(
    './basicamt_44100.onnx',
    { executionProviders: ['wasm'] }
);

self.onmessage = function ({data}) {
    const tensorInput = new ort.Tensor('float32', data, [1, 1, data.length]);
    model.then((m) => {
        return m.run({ audio: tensorInput });
    }).then((results) => {
        const note_events = createNotes(
            results.onset, results.frame,
            0.22, 0.38
        );
        self.postMessage(note_events);
    }).catch((e) => {
        // promise中的报错不会触发worker.onerror回调，即使这里throw了。所以只能用onmessage
        self.postMessage({ type: 'error', message: e.message });
    });
};