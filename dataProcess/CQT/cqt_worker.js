/**
 * 用定义计算CQT，时间复杂度很高，但是分析效果好
 */
class CQT {
    /**
     * 创建窗函数 幅度加起来为1
     * @param {number} N 
     * @returns {Float32Array} 窗幅度
     */
    static blackmanHarris(N) {
        let w = new Float32Array(N);
        const temp = 2 * Math.PI / (N - 1);
        let sum = 0;
        for (let n = 0; n < N; n++) {
            w[n] = 0.35875
                - 0.48829 * Math.cos(temp * n)
                + 0.14128 * Math.cos(temp * n * 2)
                - 0.01168 * Math.cos(temp * n * 3);
            sum += w[n];
        }
        // 归一化（幅度归一化，和矩形窗FFT除以N的效果一样）
        for (let n = 0; n < N; n++) w[n] /= sum;
        return w;
    }

    /**
     * 预计算CQT参数
     * @param {number} fs 采样率
     * @param {number} fmin 最低的频率(最低八度的C) 默认为C1
     * @param {number} octaves 要分析几个八度
     * @param {number} bins_per_octave 几平均律
     * @param {number} filter_scale Q的缩放倍数 越大频率选择性越好
     */
    constructor(fs, fmin = 32.70319566257483, octaves = 7, bins_per_octave = 12, filter_scale = 1) {
        this.fmin = fmin;
        this.bins_per_octave = bins_per_octave;
        this.bins = bins_per_octave * octaves;
        const Q = filter_scale / (Math.pow(2, 1 / bins_per_octave) - 1);
        [this.kernel_r, this.kernel_i] = CQT.iniKernel(
            Q, fs, fmin, bins_per_octave, this.bins
        );
    }
    /**
     * 得到CQT kernel 时域数据
     * @param {number} Q 
     * @param {number} fs 采样率
     * @param {number} fmin 最低音
     * @param {number} bins_per_octave 八度内的频率个数
     * @param {number} binNum 一共多少个频率
     * @returns {Array<Float32Array>} [kernel_r, kernel_i]
     */
    static iniKernel(Q, fs, fmin, bins_per_octave = 12, binNum = 84) {
        const kernel_r = Array(binNum);
        const kernel_i = Array(binNum);
        for (let i = 0; i < binNum; i++) {
            const freq = fmin * Math.pow(2, i / bins_per_octave);
            const len = Math.ceil(Q * fs / freq);
            const tmp_kernel = new Float32Array(len << 1);
            const tmp_kernel_r = kernel_r[i] = tmp_kernel.subarray(0, len);
            const tmp_kernel_i = kernel_i[i] = tmp_kernel.subarray(len, len << 1);
            const window = CQT.blackmanHarris(len);
            const omega = 2 * Math.PI * freq / fs;
            const half_len = len >> 1;
            for (let j = 0; j < len; j++) {
                const angle = omega * (j - half_len);   // 中心的相位为0
                tmp_kernel_r[j] = Math.cos(angle) * window[j];
                tmp_kernel_i[j] = -Math.sin(angle) * window[j];
                // 而且CQT1992继承自本类，用正相位增加的旋转因子可以让频域带宽在正频率上
            }
        } return [kernel_r, kernel_i];
    }
    /**
     * 计算CQT
     * @param {Float32Array} x 输入实数时序信号 会被改变！
     * @param {number} stride 
     * @returns {Array<Float32Array>} 第一维是时间，第二维是频率
     */
    cqt(x, stride) {
        let offset = stride >> 1;
        const output_length = 1 + (x.length - offset) / stride | 0;
        const output_data = new Float32Array(output_length * this.bins);
        const output = Array(output_length);
        const frameEnergy = new Float32Array(output_length);
        let pointer = 0;
        let energySum = 0;
        for (let p = 0; offset <= x.length; offset += stride) {
            const nextp = p + this.bins;
            const energy = output[pointer] = output_data.subarray(p, nextp);
            p = nextp;
            let _energySum = 0;
            for (let b = 0; b < this.bins; b++) {    // 每个频率
                const kernel_r = this.kernel_r[b];
                const kernel_i = this.kernel_i[b];
                let real = 0, imag = 0;
                const left = offset - (kernel_r.length >> 1);
                const right = Math.min(kernel_r.length, x.length - left);
                for (let i = left >= 0 ? 0 : -left; i < right; i++) {
                    const index = left + i;
                    real += x[index] * kernel_r[i];
                    imag += x[index] * kernel_i[i];
                }
                energy[b] = real * real + imag * imag;
                _energySum += energy[b];
            }
            frameEnergy[pointer] = _energySum;
            energySum += _energySum;
            ++pointer;
        }
        // 归一化
        let sigma = 1e-8;
        const meanEnergy = energySum / output_length;
        for (let t = 0; t < output_length; t++) {
            const delta = frameEnergy[t] - meanEnergy;
            sigma += delta * delta;
        }
        sigma = Math.sqrt(sigma / output_length);
        for (const frame of output) {
            for (let i = 0; i < frame.length; i++) {
                frame[i] = Math.sqrt(frame[i] / sigma);
            }
        } return output;
    }

    /**
     * 初始化 GPU kernel 缓冲区和管线
     * 管线结果为能量和相位
     * 增加的属性:
     * this.adapter
     * this.device
     * this.workgroupsize
     * this.kernelBuffer
     * this.kernelInfoBuffer
     * this.configBuffer
     * this.CQTpipeline
     * @param {number} workgroupsize 线程数
     */
    async initWebGPU(workgroupsize = 256) {
        if (!navigator.gpu) throw new Error("WebGPU not supported.");
        const adapter = this.adapter ??= await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error("No GPUAdapter found.");
        const device = this.device ??= await adapter.requestDevice();
        this.workgroupsize = workgroupsize;

        // --- kernel 缓冲区创建 ---
        const numBins = this.bins;
        const kernel_r = this.kernel_r;;
        const kernel_i = this.kernel_i;
        let totalKernelsLength = 0; // 总大小
        for (let i = 0; i < numBins; i++)
            totalKernelsLength += kernel_r[i].length << 1;
        // 创建一个在创建时即映射的 GPU 缓冲区
        const allKernelsBuffer = this.kernelBuffer ??= device.createBuffer({
            label: "All Kernels",
            size: totalKernelsLength * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE,
            mappedAtCreation: true,
        });
        const mappedKernelsRange = allKernelsBuffer.getMappedRange();
        const mappedKernelsArray = new Float32Array(mappedKernelsRange);
        const kernelInfoData = new Uint32Array(numBins * 3);    // 每个卷积核3个信息：实部偏移、虚部偏移、长度
        for (let i = 0, currentOffset = 0; i < numBins; i++) {
            const infoBaseIndex = i * 3;
            const len = kernelInfoData[infoBaseIndex + 2] = kernel_r[i].length;
            mappedKernelsArray.set(kernel_r[i], currentOffset);
            kernelInfoData[infoBaseIndex] = currentOffset;
            currentOffset += len;
            mappedKernelsArray.set(kernel_i[i], currentOffset);
            kernelInfoData[infoBaseIndex + 1] = currentOffset;
            currentOffset += len;
        } allKernelsBuffer.unmap(); // 以后不能改了

        // --- Kernel Info Buffer ---
        const kernelInfoBuffer = this.kernelInfoBuffer ??= device.createBuffer({
            label: "Kernel Info",
            size: kernelInfoData.byteLength,
            usage: GPUBufferUsage.STORAGE,
            mappedAtCreation: true,
        });
        new Uint32Array(kernelInfoBuffer.getMappedRange()).set(kernelInfoData);
        kernelInfoBuffer.unmap();

        this.configBuffer = device.createBuffer({
            label: "Config Buffer",
            size: 4 * Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        // --- CQT代码 ---
        const shaderModule = device.createShaderModule({
            label: 'CQT Energy Compute Shader',
            code: /* wgsl */`
struct KernelInfo {
    real_offset: u32,
    imag_offset: u32,
    length: u32,
};
struct Config {
    hop: u32,
    num_samples: u32,
    num_frames: u32,
    first_frame_center_offset: u32,
};
@group(0) @binding(0) var<storage, read> all_kernels: array<f32>;
@group(0) @binding(1) var<storage, read> kernel_infos: array<KernelInfo>;
@group(0) @binding(2) var<storage, read> config: Config;
@group(0) @binding(3) var<storage, read> audio: array<f32>;
@group(0) @binding(4) var<storage, read_write> output: array<f32>;
// 共享内存 用于协作加载 kernel 能提速6%
var<workgroup> s_kernel_r: array<f32, ${workgroupsize}>;
var<workgroup> s_kernel_i: array<f32, ${workgroupsize}>;

// 一次计算一个频点的workgroupsize个时间帧 使得负载均匀
@compute @workgroup_size(${workgroupsize})
fn main(
    @builtin(workgroup_id) workgroup_id: vec3<u32>, // (numBins, blocks, 1)
    @builtin(local_invocation_id) local_id: vec3<u32>
) {
    let frame = workgroup_id.y * ${workgroupsize}u + local_id.x;
    let bin_idx = workgroup_id.x;
    let info = kernel_infos[bin_idx];
    let klen = info.length;
    // 计算当前帧对应的音频起始位置
    let frame_center_pos = i32(config.first_frame_center_offset + frame * config.hop);
    let left = frame_center_pos - i32(klen >> 1u);
    let num_samples_i32 = i32(config.num_samples);

    var real: f32 = 0.0;
    var imag: f32 = 0.0;
    for (var base_k: u32 = 0u; base_k < klen; base_k = base_k + ${workgroupsize}u) {
        let t_idx = local_id.x;
        let load_k_idx = base_k + t_idx;
        // 超出kernel长度的填0 (对于最后一块tile很重要)
        let valid = load_k_idx < klen;
        s_kernel_r[t_idx] = select(0.0, all_kernels[info.real_offset + load_k_idx], valid);
        s_kernel_i[t_idx] = select(0.0, all_kernels[info.imag_offset + load_k_idx], valid);
        workgroupBarrier();
        if (frame < config.num_frames) {
            let current_block_size = min(${workgroupsize}u, klen - base_k);
            for (var j: u32 = 0u; j < current_block_size; j = j + 1u) {
                let audio_idx = left + i32(base_k + j);
                // 边界检查 在音频两端补零
                if (audio_idx >= 0 && audio_idx < num_samples_i32) {
                    let audioSample = audio[u32(audio_idx)];
                    real = fma(audioSample, s_kernel_r[j], real);
                    imag = fma(audioSample, s_kernel_i[j], imag);
                }
            }
        } workgroupBarrier();
    }
    if (frame >= config.num_frames) { return; }
    // 频率优先存储
    let out_index = ${this.bins} * frame + bin_idx;
    output[out_index] = output[out_index] + real * real + imag * imag;  // 如果多通道会累加
}`
        });
        this.CQTpipeline ??= device.createComputePipeline({
            label: 'CQT Full Compute Pipeline', layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' },
        });
    }

    /**
     * 使用GPU计算CQT 需要先调用 initWebGPU
     * 第一次传入的音频数据会被视为尺寸用于后续所有计算
     * @param {Float32Array} audioData 
     * @param {number} hop 
     */
    cqt_GPU(audioData, hop) {
        const device = this.device;
        const numBins = this.bins;

        // 配置
        const offset0 = hop >> 1;
        const numFrames = 1 + (audioData.length - offset0 - 1) / hop | 0;
        device.queue.writeBuffer(this.configBuffer, 0, new Uint32Array([hop, audioData.length, numFrames, offset0]));
        // 输入
        this.inputAudioBuffer ??= device.createBuffer({
            label: "Full Audio Buffer",
            size: audioData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.inputAudioBuffer, 0, audioData);
        // 输出
        const totalValues = numFrames * numBins;
        const outputBufferSize = totalValues * Float32Array.BYTES_PER_ELEMENT;
        this.outputBuffer ??= device.createBuffer({
            label: "CQT Output Buffer",
            size: outputBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });

        const bindGroup = device.createBindGroup({
            label: 'CQT Bind Group', layout: this.CQTpipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.kernelBuffer } },
                { binding: 1, resource: { buffer: this.kernelInfoBuffer } },
                { binding: 2, resource: { buffer: this.configBuffer } },
                { binding: 3, resource: { buffer: this.inputAudioBuffer } },
                { binding: 4, resource: { buffer: this.outputBuffer } },
            ],
        });

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.CQTpipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(numBins, Math.ceil(numFrames / this.workgroupsize));
        pass.end();
        device.queue.submit([encoder.finish()]);
        return numFrames;
    }

    /**
     * 提取GPU数据并用CPU归一化
     * @param {GPUBuffer} buffer 要归一化的
     * @param {number} numFrames 帧数
     * @returns {Array<Float32Array>} 归一化后的幅度谱矩阵
     */
    async norm_CPU(buffer, numFrames) {
        const device = this.device;
        const readBuffer = device.createBuffer({
            label: "Read CQT Buffer",
            size: buffer.size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(buffer, 0, readBuffer, 0, buffer.size);
        device.queue.submit([encoder.finish()]);
        await readBuffer.mapAsync(GPUMapMode.READ);
        const resultArray = new Float32Array(readBuffer.getMappedRange()).slice();
        const ampMatrix = Array(numFrames);
        for (let t = 0, offset = 0; t < numFrames; t++) {
            const next = offset + this.bins;
            ampMatrix[t] = resultArray.subarray(offset, next);
            offset = next;
        }
        readBuffer.destroy();
        // 归一化
        const frameEnergy = new Float32Array(numFrames);
        let energySum = 0;
        for (let t = 0; t < numFrames; t++) {
            const frame = ampMatrix[t];
            for (let i = 0; i < frame.length; i++)
                frameEnergy[t] += frame[i];
            energySum += frameEnergy[t];
        }
        // 计算能量方差
        let sigma = 1e-8;
        const meanEnergy = energySum / numFrames;
        for (let t = 0; t < numFrames; t++) {
            const delta = frameEnergy[t] - meanEnergy;
            sigma += delta * delta;
        }
        sigma = Math.sqrt(sigma / numFrames);
        // 归一化
        for (let i = 0; i < resultArray.length; i++) {
            resultArray[i] = Math.sqrt(resultArray[i] / sigma);
        } return ampMatrix;
    }

    async norm_GPU(buffer, numFrames) {
        const device = this.device;
        // 求帧能量
        const sumBuffer = device.createBuffer({
            label: "sum Buffer",
            size: numFrames * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const sumShader = device.createShaderModule({
            label: 'Freq Sum Compute Shader',
            code: /* wgsl */`
@group(0) @binding(0) var<storage, read_write> spectrum: array<f32>;
@group(0) @binding(1) var<storage, read_write> rowSums: array<f32>;
@compute @workgroup_size(${this.workgroupsize})
fn main(
    @builtin(workgroup_id) workgroup_id: vec3<u32>, // (blocks, 1, 1)
    @builtin(local_invocation_id) local_id: vec3<u32>
) {
    var sum: f32 = 0.0;
    let frame = workgroup_id.x * ${this.workgroupsize}u + local_id.x;
    let base = frame * ${this.bins}u;
    if (frame >= ${numFrames}u) { return; }
    for (var bin: u32 = 0u; bin < ${this.bins}u; bin = bin + 1u) {
        sum = sum + spectrum[base + bin];
    } rowSums[frame] = sum;
}`});
        const sumPipe = device.createComputePipeline({
            label: 'Freq Sum Compute Pipeline', layout: 'auto',
            compute: { module: sumShader, entryPoint: 'main' },
        });
        const sum_bindGroup = device.createBindGroup({
            label: 'CQT Bind Group', layout: sumPipe.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: buffer } },
                { binding: 1, resource: { buffer: sumBuffer } },
            ],
        });
        // 拷贝到CPU计算方差
        const readSumBuffer = device.createBuffer({
            label: "Read Sum Buffer",
            size: sumBuffer.size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        // 提交指令
        const encoder1 = device.createCommandEncoder();
        const pass1 = encoder1.beginComputePass();
        pass1.setPipeline(sumPipe);
        pass1.setBindGroup(0, sum_bindGroup);
        pass1.dispatchWorkgroups(Math.ceil(numFrames / this.workgroupsize));
        pass1.end();
        encoder1.copyBufferToBuffer(sumBuffer, 0, readSumBuffer, 0, readSumBuffer.size);
        device.queue.submit([encoder1.finish()]);

        const thread_works = this.bins; // 每个线程处理几频点 防止调度开销过大
        const normShader = device.createShaderModule({
            label: 'CQT Norm Compute Shader',
            code: /* wgsl */`
@group(0) @binding(0) var<storage, read_write> spectrum: array<f32>;
@group(0) @binding(1) var<uniform> sigma: f32;
@compute @workgroup_size(${this.workgroupsize})
fn main(
    @builtin(global_invocation_id) workgroup_id: vec3<u32>
) {
    var frame = ${thread_works}u * workgroup_id.x;
    if (frame >= ${numFrames}u) { return; }
    for (var i: u32 = 0u; i < ${thread_works}u; i = i + 1u) {
        spectrum[frame] = sqrt(spectrum[frame] / sigma);
        frame = frame + 1u;
    }
}`});
        const normPipe = device.createComputePipeline({
            label: 'CQT Norm Compute Pipeline', layout: 'auto',
            compute: { module: normShader, entryPoint: 'main' },
        });
        const sigmaBuffer = device.createBuffer({
            size: Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.UNIFORM,
            mappedAtCreation: true,
        });
        const norm_bindGroup = device.createBindGroup({
            label: 'CQT Norm Bind Group', layout: normPipe.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: buffer } },
                { binding: 1, resource: { buffer: sigmaBuffer } },
            ],
        });

        // 读取结果算方差
        await readSumBuffer.mapAsync(GPUMapMode.READ);
        const rowSums = new Float32Array(readSumBuffer.getMappedRange());
        const std = (arr) => {
            let mean = 0, M2 = 0, n = 0;
            for (const x of arr) {
                n++;
                const delta = x - mean;
                mean += delta / n;
                M2 += delta * (x - mean);
            } return Math.sqrt(M2 / n);
        }
        const sigma = std(rowSums);
        sumBuffer.destroy();
        readSumBuffer.destroy();
        new Float32Array(sigmaBuffer.getMappedRange()).set(new Float32Array([sigma]));
        sigmaBuffer.unmap();

        const readBuffer = device.createBuffer({
            label: "Read CQT Buffer",
            size: buffer.size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const encoder2 = device.createCommandEncoder();
        const pass2 = encoder2.beginComputePass();
        pass2.setPipeline(normPipe);
        pass2.setBindGroup(0, norm_bindGroup);
        pass2.dispatchWorkgroups(Math.ceil(numFrames * this.bins / (this.workgroupsize * thread_works)));
        pass2.end();
        encoder2.copyBufferToBuffer(buffer, 0, readBuffer, 0, buffer.size);
        device.queue.submit([encoder2.finish()]);
        await readBuffer.mapAsync(GPUMapMode.READ);
        const resultArray = new Float32Array(readBuffer.getMappedRange()).slice();
        const ampMatrix = Array(numFrames);
        for (let t = 0, offset = 0; t < numFrames; t++) {
            const next = offset + this.bins;
            ampMatrix[t] = resultArray.subarray(offset, next);
            offset = next;
        }
        sigmaBuffer.destroy();
        readBuffer.destroy();
        return ampMatrix;
    }

    freeGPU() {
        this.kernelBuffer?.destroy();
        this.kernelInfoBuffer?.destroy();
        this.configBuffer?.destroy();
        this.inputAudioBuffer?.destroy();
        this.outputBuffer?.destroy();
        this.freqParamArray?.destroy();
        this.kernelBuffer = null;
        this.kernelInfoBuffer = null;
        this.configBuffer = null;
        this.inputAudioBuffer = null;
        this.outputBuffer = null;
        this.freqParamArray = null;
        this.CQTpipeline = this.device = this.adapter = null;
    }
}

self.onmessage = async ({ data }) => {
    let { audioChannel, sampleRate, hop, fmin, useGPU } = data;
    const cqt = new CQT(sampleRate, fmin, 7, 12, 2.8);
    let cqtData;
    try {
        if (useGPU === false) throw new Error("强制使用CPU计算");
        await cqt.initWebGPU(256);
        console.log("WebGPU初始化成功,使用GPU计算CQT");
        const numFrames = cqt.cqt_GPU(audioChannel[0], hop);
        if (audioChannel.length > 1) {
            // 开启第二通道的计算 会累加到cqt.outputBuffer
            cqt.device.queue.writeBuffer(cqt.inputAudioBuffer, 0, audioChannel[1]);
            cqt.cqt_GPU(audioChannel[1], hop);
        }
        cqtData = await cqt.norm_CPU(cqt.outputBuffer, numFrames);
        // cqtData = await cqt.norm_GPU(cqt.outputBuffer, numFrames);
        cqt.freeGPU();
    } catch (e) {
        console.log("使用CPU计算CQT\n原因:", e.message);
        cqtData = cqt.cqt(audioChannel[0], hop);
        // 第二个通道
        if (audioChannel.length > 1) {
            let cqtData2 = cqt.cqt(audioChannel[1], hop);
            for (let i = 0; i < cqtData.length; i++) {
                const temp1 = cqtData[i];
                const temp2 = cqtData2[i];
                for (let j = 0; j < cqtData[i].length; j++)
                    temp1[j] = (temp1[j] + temp2[j]) * 0.5;
            }
        }
    }
    // 要求cqtData都是一整块
    self.postMessage(cqtData, [cqtData[0].buffer, ...audioChannel.map(x => x.buffer)]);
    self.close();
};
