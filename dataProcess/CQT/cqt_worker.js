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
        const output = Array(output_length);
        const frameEnergy = new Float32Array(output_length);
        let pointer = 0;
        let energySum = 0;
        for (; offset <= x.length; offset += stride) {
            const energy = output[pointer] = new Float32Array(this.bins);
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
        sigma = Math.sqrt(sigma / (output_length - 1));
        for (const frame of output) {
            for (let i = 0; i < frame.length; i++) {
                frame[i] = Math.sqrt(frame[i] / sigma);
            }
        }
        return output;
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
     * @param {number} workgroupsize 
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
            label: 'CQT Energy/Phase Compute Shader',
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
struct CQTResult {
    energy: f32,
    phase: f32,
};
@group(0) @binding(0) var<storage, read> all_kernels: array<f32>;
@group(0) @binding(1) var<storage, read> kernel_infos: array<KernelInfo>;
@group(0) @binding(2) var<storage, read> config: Config;
@group(0) @binding(3) var<storage, read> audio: array<f32>; // 原始、未填充的音频
@group(0) @binding(4) var<storage, read_write> output: array<CQTResult>;

// 一次计算一个频点的workgroupsize个时间帧 使得负载均匀
@compute @workgroup_size(${workgroupsize})
fn main(
    @builtin(workgroup_id) workgroup_id: vec3<u32>, // (numBins, blocks, 1)
    @builtin(local_invocation_id) local_id: vec3<u32>
) {
    let frame = workgroup_id.y * ${workgroupsize}u + local_id.x;    // 现在在第几个时间帧
    if (frame >= config.num_frames) {return;}
    let bin_idx = workgroup_id.x; // 现在在第几个频点

    let info = kernel_infos[bin_idx];
    let klen = info.length;

    let frame_center_pos = i32(config.first_frame_center_offset + frame * config.hop);
    let left: i32 = frame_center_pos - i32(klen >> 1u);
    let start_i: u32 = u32(max(0, -left));
    let end_i: u32 = min(klen, u32(i32(config.num_samples) - left));

    var real: f32 = 0.0;
    var imag: f32 = 0.0;
    for (var i: u32 = start_i; i < end_i; i = i + 1u) {
        let idx = u32(left + i32(i));
        let audioSample = audio[idx];
        real = fma(audioSample, all_kernels[info.real_offset + i], real);
        imag = fma(audioSample, all_kernels[info.imag_offset + i], imag);
    }
    let energy = real * real + imag * imag;
    let phase = atan2(imag, real);

    // 时间优先存储
    let out_index = config.num_frames * bin_idx + frame;
    output[out_index].energy = energy;
    output[out_index].phase = phase;
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
        // 输出缓冲区
        const totalValues = numFrames * numBins;
        const outputBufferSize = 2 * totalValues * Float32Array.BYTES_PER_ELEMENT; // 能量+相位
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
        return { numFrames, outputBufferSize };
    }

    /**
     * 后处理一个通道的GPU计算结果
     * @param {GPUBuffer} channelBuffer 
     * @param {number} numFrames 
     * @param {number} fhop 
     * @returns {Promise<{amp: Array<Float32Array>, freq: Array<Float32Array>}>} 
     */
    async ChannelPostProcess(channelBuffer, numFrames, fhop) {
        const device = this.device;
        const numBins = this.bins;
        // 输出
        const combineEngBuffer = device.createBuffer({
            label: "CQT Combined Energy Buffer",
            size: numFrames * numBins * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const combineFreqBuffer = device.createBuffer({
            label: "CQT Combined Frequency Buffer",
            size: (numFrames - 1) * numBins * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });

        const shaderModule = device.createShaderModule({
            label: 'CQT 1 Channel Postprocess Compute Shader',
            code: /* wgsl */`
struct CQTResult {
    energy: f32,
    phase: f32,
};
// 输入为行优先
@group(0) @binding(0) var<storage, read_write> combined_energy: array<f32>;
@group(0) @binding(1) var<storage, read_write> combined_frequency: array<f32>;
@group(0) @binding(2) var<storage, read> channel: array<CQTResult>;

const PI: f32 = 3.14159265358979323846;
const TWO_PI: f32 = 6.28318530717958647692;
const BIN_NUM: u32 = ${numBins}u;
const FRAME_NUM: u32 = ${numFrames}u;
const FHOP: f32 = ${fhop};

fn unwrap(phase_diff: f32) -> f32 {
    return phase_diff - TWO_PI * floor((phase_diff + PI) / TWO_PI);
}

@compute @workgroup_size(${numBins})
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let bin_idx = global_id.x;
    let offset = FRAME_NUM * bin_idx;
    let freq: f32 = ${this.fmin} * pow(2.0, f32(bin_idx) / ${this.bins_per_octave}.0);
    let expected_dphi: f32 = TWO_PI * freq * FHOP;
    combined_energy[bin_idx] = channel0[offset].energy + channel1[offset].energy;
    for (var frame: u32 = 1u; frame < FRAME_NUM; frame = frame + 1u) {
        let idx = offset + frame;
        let idx_prev = idx - 1u;
        combined_energy[BIN_NUM * frame + bin_idx] = channel[idx].energy + channel[idx].energy;
        let dp = channel[idx].phase - channel[idx_prev].phase;
        let dphi = unwrap(dp - expected_dphi);
        combined_frequency[idx_prev] = dphi / (TWO_PI * FHOP) + freq;
    }
}`
        });
        const computePipeline = device.createComputePipeline({
            label: 'CQT Full Compute Pipeline', layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' },
        });
        const bindGroup = device.createBindGroup({
            label: 'CQT Full Bind Group', layout: computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: combineEngBuffer } },
                { binding: 1, resource: { buffer: combineFreqBuffer } },
                { binding: 2, resource: { buffer: channelBuffer } },
            ],
        });

        // 读取
        const stagingEngBuffer = device.createBuffer({
            label: "Staging Combined Energy Buffer",
            size: combineEngBuffer.size,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        const stagingFreqBuffer = device.createBuffer({
            label: "Staging Combined Frequency Buffer",
            size: combineFreqBuffer.size,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(computePipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(numBins);
        pass.end();
        encoder.copyBufferToBuffer(combineEngBuffer, 0, stagingEngBuffer, 0, stagingEngBuffer.size);
        encoder.copyBufferToBuffer(combineFreqBuffer, 0, stagingFreqBuffer, 0, stagingFreqBuffer.size);
        device.queue.submit([encoder.finish()]);

        await stagingEngBuffer.mapAsync(GPUMapMode.READ);
        const combinedEnergy = new Float32Array(stagingEngBuffer.getMappedRange());
        const spectrum = CQT.organizeGPUEngResult(combinedEnergy, numFrames, numBins);
        stagingEngBuffer.unmap();
        await stagingFreqBuffer.mapAsync(GPUMapMode.READ);
        const combinedFrequency = new Float32Array(stagingFreqBuffer.getMappedRange());
        const frequency = CQT.organizeGPUFreqResult(combinedFrequency, numFrames - 1, numBins);
        stagingFreqBuffer.unmap();

        // 清理
        combineEngBuffer.destroy();
        combineFreqBuffer.destroy();
        stagingEngBuffer.destroy();
        stagingFreqBuffer.destroy();

        return {
            amp: spectrum,
            freq: frequency
        };
    }

    /**
     * 合并2通道的GPU计算结果
     * @param {GPUBuffer[2]} channelBuffers 
     * @param {number} numFrames
     * @param {number} fhop hop的频率 应该为hop/sampleRate
     * @returns {Promise<{amp: Array<Float32Array>, freq: Array<Float32Array>}>} 
     */
    async combine2GPUChannels(channelBuffers, numFrames, fhop) {
        const device = this.device;
        const numBins = this.bins;
        // 输出
        const combineEngBuffer = device.createBuffer({
            label: "CQT Combined Energy Buffer",
            size: numFrames * numBins * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const combineFreqBuffer = device.createBuffer({
            label: "CQT Combined Frequency Buffer",
            size: (numFrames - 1) * numBins * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });

        const shaderModule = device.createShaderModule({
            label: 'CQT Channel Combine Compute Shader',
            code: /* wgsl */`
struct CQTResult {
    energy: f32,
    phase: f32,
};
// 输入为行优先
@group(0) @binding(0) var<storage, read_write> combined_energy: array<f32>;
@group(0) @binding(1) var<storage, read_write> combined_frequency: array<f32>;
@group(0) @binding(2) var<storage, read> channel0: array<CQTResult>;
@group(0) @binding(3) var<storage, read> channel1: array<CQTResult>;

const PI: f32 = 3.14159265358979323846;
const TWO_PI: f32 = 6.28318530717958647692;
const BIN_NUM: u32 = ${numBins}u;
const FRAME_NUM: u32 = ${numFrames}u;
const FHOP: f32 = ${fhop};

fn unwrap(phase_diff: f32) -> f32 {
    return phase_diff - TWO_PI * floor((phase_diff + PI) / TWO_PI);
}

@compute @workgroup_size(${numBins})
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let bin_idx = global_id.x;
    let offset = FRAME_NUM * bin_idx;
    let freq: f32 = ${this.fmin} * pow(2.0, f32(bin_idx) / ${this.bins_per_octave}.0);
    let expected_dphi: f32 = TWO_PI * freq * FHOP;
    // 先填充0时刻的能量 能量列优先
    combined_energy[bin_idx] = channel0[offset].energy + channel1[offset].energy;
    for (var frame: u32 = 1u; frame < FRAME_NUM; frame = frame + 1u) {
        let idx = offset + frame;
        let idx_prev = idx - 1u;
        combined_energy[BIN_NUM * frame + bin_idx] = channel0[idx].energy + channel1[idx].energy;
        var weight1 = sqrt(channel0[idx].energy * channel0[idx_prev].energy);
        var weight2 = sqrt(channel1[idx].energy * channel1[idx_prev].energy);
        var phase1: f32 = channel0[idx].phase - channel0[idx_prev].phase;
        var phase2: f32 = channel1[idx].phase - channel1[idx_prev].phase;
        var imag_sum: f32 = weight1 * sin(phase1) + weight2 * sin(phase2);
        var real_sum: f32 = weight1 * cos(phase1) + weight2 * cos(phase2);
        let dphi: f32 = unwrap(atan2(imag_sum, real_sum) - expected_dphi);
        combined_frequency[idx_prev] = dphi / (TWO_PI * FHOP) + freq;   // 频率行优先
    }
}`
        });
        const computePipeline = device.createComputePipeline({
            label: 'CQT Full Compute Pipeline', layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' },
        });
        const bindGroup = device.createBindGroup({
            label: 'CQT Full Bind Group', layout: computePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: combineEngBuffer } },
                { binding: 1, resource: { buffer: combineFreqBuffer } },
                { binding: 2, resource: { buffer: channelBuffers[0] } },
                { binding: 3, resource: { buffer: channelBuffers[1] } }
            ],
        });

        // 读取
        const stagingEngBuffer = device.createBuffer({
            label: "Staging Combined Energy Buffer",
            size: combineEngBuffer.size,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        const stagingFreqBuffer = device.createBuffer({
            label: "Staging Combined Frequency Buffer",
            size: combineFreqBuffer.size,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(computePipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(numBins);
        pass.end();
        encoder.copyBufferToBuffer(combineEngBuffer, 0, stagingEngBuffer, 0, stagingEngBuffer.size);
        encoder.copyBufferToBuffer(combineFreqBuffer, 0, stagingFreqBuffer, 0, stagingFreqBuffer.size);
        device.queue.submit([encoder.finish()]);

        await stagingEngBuffer.mapAsync(GPUMapMode.READ);
        const combinedEnergy = new Float32Array(stagingEngBuffer.getMappedRange());
        const spectrum = CQT.organizeGPUEngResult(combinedEnergy, numFrames, numBins);
        stagingEngBuffer.unmap();
        await stagingFreqBuffer.mapAsync(GPUMapMode.READ);
        const combinedFrequency = new Float32Array(stagingFreqBuffer.getMappedRange());
        const frequency = CQT.organizeGPUFreqResult(combinedFrequency, numFrames - 1, numBins);
        stagingFreqBuffer.unmap();

        // 清理
        combineEngBuffer.destroy();
        combineFreqBuffer.destroy();
        stagingEngBuffer.destroy();
        stagingFreqBuffer.destroy();

        return {
            amp: spectrum,
            freq: frequency
        };
    }

    /**
     * 从GPU内存的CPU视图中复制、整理频率结果
     * 频率是行优先存储的
     * @param {Float32Array} GPUresult 内存还在GPU上
     * @param {number} numFrames 是实际长度-1
     * @param {number} numBins this.bins
     * @returns {Array<Float32Array>} 频率矩阵 行优先
     */
    static organizeGPUFreqResult(GPUresult, numFrames, numBins) {
        const freqMatrix = Array(numBins);
        for (let f = 0, offset = 0; f < numBins; f++) {
            const freqFrame = freqMatrix[f] = new Float32Array(numFrames);
            freqFrame.set(GPUresult.subarray(offset, offset + numFrames));
            offset += numFrames;
        } return freqMatrix;
    }

    /**
     * 从GPU内存的CPU视图中复制、整理能量结果
     * 能量是列优先存储的
     * @param {Float32Array} GPUresult 内存还在GPU上
     * @param {number} numFrames 是实际长度
     * @param {number} numBins this.bins
     * @returns {Array<Float32Array>} 幅度矩阵 列优先
     */
    static organizeGPUEngResult(GPUresult, numFrames, numBins) {
        // 能量是列优先
        const engMatrix = Array(numFrames);
        let enerygSum = 0;
        let frameEnergy = new Float32Array(numFrames);
        for (let t = 0, offset = 0; t < numFrames; t++, offset += numBins) {
            const engFrame = engMatrix[t] = new Float32Array(numBins);
            engFrame.set(GPUresult.subarray(offset, offset + numBins));
            for (let b = 0; b < numBins; b++) {
                frameEnergy[t] += engFrame[b];
            } enerygSum += frameEnergy[t];
        }
        // 归一化
        let sigma = 1e-8;
        const meanEnergy = enerygSum / numFrames;
        for (let t = 0; t < engMatrix.length; t++) {
            const delta = frameEnergy[t] - meanEnergy;
            sigma += delta * delta;
        }
        sigma = Math.sqrt(sigma / (engMatrix.length - 1));
        for (const frame of engMatrix) {
            for (let i = 0; i < frame.length; i++) {
                frame[i] = Math.sqrt(frame[i] / sigma);
            }
        } return engMatrix;
    }

    freeGPU() {
        this.kernelBuffer?.destroy();
        this.kernelInfoBuffer?.destroy();
        this.configBuffer?.destroy();
        this.inputAudioBuffer?.destroy();
        this.outputBuffer?.destroy();
        this.kernelBuffer = null;
        this.kernelInfoBuffer = null;
        this.configBuffer = null;
        this.inputAudioBuffer = null;
        this.outputBuffer = null;
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
        const {numFrames, outputBufferSize} = cqt.cqt_GPU(audioChannel[0], hop);
        if (audioChannel.length > 1) {
            // 先复制到另一个buffer
            const channel0 = cqt.device.createBuffer({
                label: "Staging Buffer",
                size: outputBufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            const encoder = cqt.device.createCommandEncoder();
            encoder.copyBufferToBuffer(cqt.outputBuffer, 0, channel0, 0, outputBufferSize);
            cqt.device.queue.submit([encoder.finish()]);
            // 开启第二通道的计算
            cqt.device.queue.writeBuffer(cqt.inputAudioBuffer, 0, audioChannel[1]);
            cqt.cqt_GPU(audioChannel[1], hop);
            cqtData = await cqt.combine2GPUChannels([channel0, cqt.outputBuffer], numFrames, hop / sampleRate);
        } else {
            cqtData = await cqt.ChannelPostProcess(cqt.outputBuffer, numFrames, hop / sampleRate);
        }
        cqt.freeGPU();
        cqtData = cqtData.amp;  // 暂时只返回能量
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
    self.postMessage(cqtData, [...cqtData.map(x => x.buffer), ...audioChannel.map(x => x.buffer)]);
    self.close();
};
