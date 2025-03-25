// const ort_folder = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
// self.importScripts(ort_folder + 'ort.wasm.min.js');
// ort.env.wasm.wasmPaths = ort_folder;

self.importScripts('./dist/bundle.min.js')
ort.env.wasm.wasmPaths = './dist/';

const model = ort.InferenceSession.create(
    './basicamt_44100.onnx', // webgpu报错cat（但是没问题啊？），webgl不支持int64，所以只能用cpu
);

self.onmessage = function ({data}) {
    const tensorInput = new ort.Tensor('float32', data, [1, 1, data.length]);
    model.then((m) => {
        return m.run({ audio: tensorInput });
    }).then((results) => {
        const note_events = createNotes(results.onset, results.frame);
        self.postMessage(note_events);
    }).catch((e) => {
        // promise中的报错不会触发worker.onerror回调，即使这里throw了。所以只能用onmessage
        self.postMessage({ type: 'error', message: e.message });
    });
};

function createNotes(
    onsetTensor, frameTensor,
    frame_thresh = 0.145,
    onset_thresh = 0.42,
    min_note_len = 6,
    energy_tol = 10,
    midi_offset = 24
) {
    // 模型中已经对onset和frame进行归一化了
    const raw_frameData = frameTensor.cpuData;
    const frameDim = frameTensor.dims;  // [1, 84, frames]
    const raw_onsetData = onsetTensor.cpuData;
    const onsetDim = onsetTensor.dims;  // [1, 84, frames]
    // 两个dim应该一样
    if (frameDim[1] !== onsetDim[1] || frameDim[2] !== onsetDim[2]) {
        throw new Error("frameDim[1] !== onsetDim[1] || frameDim[2] !== onsetDim[2]");
    }
    const frameNum = frameDim[2];
    const noteNum = frameDim[1];

    const frameData = Array(noteNum);
    const onsetData = Array(noteNum);
    for (let i = 0; i < noteNum; i++) {
        // 和raw共享内存
        frameData[i] = new Float32Array(raw_frameData.buffer, i * frameNum * 4, frameNum);
        onsetData[i] = new Float32Array(raw_onsetData.buffer, i * frameNum * 4, frameNum);
    }

    get_infered_onsets(onsetData, frameData, 3);

    const peaks = findPeak(onsetData, onset_thresh);
    peaks.sort((a, b) => b[0] - a[0]);  // 按照时间反过来排序

    const remaining_energy = Array(noteNum);    // 复制一份frameData，用于修改数据
    for (let i = 0; i < noteNum; i++) remaining_energy[i] = new Float32Array(frameData[i]);

    const note_events = [];
    for (const [note_start_idx, freq_idx] of peaks) {
        // 如果剩下的距离不够放一个最短的音符，就跳过
        if (note_start_idx >= frameNum - min_note_len) continue;

        let note_end_idx = note_start_idx + 1;
        let k = 0;  // 连续k个小于frame_thresh的帧
        const freqArray = remaining_energy[freq_idx];
        // 向后搜索，连续energy_tol帧小于frame_thresh（或者到达最后一帧），就认为这个音符结束。目的是将分散的frames合并
        while (note_end_idx < frameNum && k < energy_tol) {
            if (freqArray[note_end_idx] < frame_thresh) k++;
            else k = 0;
            note_end_idx++;
        }
        note_end_idx -= k;  // 回到音符结尾

        if (note_end_idx - note_start_idx < min_note_len) continue;  // 跳过短音符
        freqArray.fill(0, note_start_idx, note_end_idx);  // 将这个音符的frame清零

        // 认为半音不会同时出现，因为不能构成和弦
        if (freq_idx < noteNum - 1)
            remaining_energy[freq_idx + 1].fill(0, note_start_idx, note_end_idx);
        if (freq_idx > 0)
            remaining_energy[freq_idx - 1].fill(0, note_start_idx, note_end_idx);

        // 对frameData在start和end中间的求平均
        let sum = 0;
        for (let i = note_start_idx; i < note_end_idx; i++)
            sum += frameData[freq_idx][i];

        note_events.push({
            onset: note_start_idx,
            offset: note_end_idx,
            note: freq_idx + midi_offset,
            velocity: sum / (note_end_idx - note_start_idx)
        });
    }
    
    // 不依赖onset，根据frames中的极大值找额外的音符
    const maxes = [];
    for (let n = 0; n < noteNum; n++) {
        const thisNote = frameData[n];
        for (let t = 1; t < frameNum; t++) {
            if (thisNote[t] > frame_thresh) maxes.push([thisNote[t], n, t]);
        }
    }
    maxes.sort((a, b) => b[0] - a[0]);  // 按照能量从大到小排序

    for (const [_, n, t] of maxes) {
        // 可能被前面的循环置零了
        if (remaining_energy[n][t] < frame_thresh) continue;
        // 后向搜索
        let note_end_idx = t + 1;
        let k = 0;
        const freqArray = remaining_energy[n];
        while (note_end_idx < frameNum && k < energy_tol) {
            if (freqArray[note_end_idx] < frame_thresh) k++;
            else k = 0;
            note_end_idx++;
        }
        note_end_idx -= k;
        // 前向搜索
        let note_start_idx = t - 1;
        k = 0;
        while (note_start_idx > 0 && k < energy_tol) {
            if (freqArray[note_start_idx] < frame_thresh) k++;
            else k = 0;
            note_start_idx--;
        }
        note_start_idx += (k + 1);  // 之前多减了1，而fill是左闭右开

        // 不管长度符不符合，都置零
        freqArray.fill(0, note_start_idx, note_end_idx);
        if (n < noteNum - 1)
            remaining_energy[n + 1].fill(0, note_start_idx, note_end_idx);
        if (n > 0)
            remaining_energy[n - 1].fill(0, note_start_idx, note_end_idx);


        if (note_end_idx - note_start_idx < min_note_len) continue;

        let sum = 0;
        for (let i = note_start_idx; i < note_end_idx; i++)
            sum += frameData[n][i];

        note_events.push({
            onset: note_start_idx,
            offset: note_end_idx,
            note: n + midi_offset,
            velocity: sum / (note_end_idx - note_start_idx)
        });
    }
    return note_events;
}

/**
 * 从frame中推断新的onset 会修改传入的的onsets
 * @param {Array<Float32Array>} onsets 
 * @param {Array<Float32Array>} frames 
 * @param {number} n_diff 
 */
function get_infered_onsets(onsets, frames, n_diff = 2) {
    const frameNum = frames[0].length;
    const noteNum = frames.length;
    const inffered_onsets = Array(noteNum);
    let infered_max = -1e10;    // 用于归一化
    for (let n = 0; n < noteNum; n++) {
        const notetime = new Float32Array(frameNum);
        const thisFrame = frames[n];
        for (let t = n_diff; t < frameNum; t++) {
            let min_diff = 1e10;
            // 对每个时间点求最小的差值
            for (let k = 1; k <= n_diff; k++) {
                let diff = thisFrame[t] - thisFrame[t - k];
                if (diff < min_diff) min_diff = diff;
            }
            if (min_diff > infered_max) infered_max = min_diff;
            notetime[t] = min_diff;
        }
        inffered_onsets[n] = notetime
    }
    // 归一化 由于onset在模型内部已经归一化了，所以onset的最大值就是1
    for (let n = 0; n < noteNum; n++) {
        for (let t = 0; t < frameNum; t++) {
            let temp = inffered_onsets[n][t] / infered_max;
            if (temp > onsets[n][t]) onsets[n][t] = temp;
        }
    }
}

function findPeak(x2d, threshold = 0) {
    const H = x2d.length;
    const W = x2d[0].length - 1;
    let peak = [];
    for (let h = 0; h < H; h++) {
        const row = x2d[h];
        let last_is_up = true;  // 由于模型用的是sigmoid，所以全部大于零，所以第一个之前的导数一定大于零
        for (let w = 0; w < W; w++) {
            if (row[w] < threshold) continue;
            if (last_is_up) {
                if (row[w] > row[w + 1]) {  // 下一个小于当前，说明当前是峰值
                    peak.push([w, h]);
                    last_is_up = false;
                } else if (row[w] == row[w + 1]) {
                    let _w = w + 1;
                    // 下一个等于当前，要看后面第一个非零导数是否小于零
                    while (_w < W) {
                        if (row[_w] == row[_w + 1]) _w++;
                        else if (row[_w] < row[_w + 1]) break;
                        else {  // 后面变小了，说明当前是峰值
                            last_is_up = false;
                            peak.push([w, h]);
                            w = _w;
                            break;
                        }
                    }
                }
            } else {
                last_is_up = (row[w] < row[w + 1]);
            } 
        }
    } return peak;
}