/**
 * Short-Time Real Fourier Transform using WebGPU
 */
class STFTGPU {
    static reverseBits(N) {
        const reverseBits = new Uint32Array(N);
        const bits = Math.log2(N);
        for (let i = 0; i < N; i++) {
            let r = 0, n = i;
            for (let j = 0; j < bits; j++) {
                r = (r << 1) | (n & 1);
                n >>= 1;
            } reverseBits[i] = r;
        } return reverseBits;
    }
    constructor(fftN = 8192, hopSize) {
        this.fftN = 1 << Math.ceil(Math.log2(fftN));
        this.realN = this.fftN >> 1;
        this.hopSize = hopSize;
    }
    async initWebGPU(workgroup_size_pow = 8) {  // 最大为8
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error("WebGPU adapter not found.");
        const device = await adapter.requestDevice({
            requiredLimits: {
                maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
                maxBufferSize: adapter.limits.maxBufferSize,
            }
        });
        if (!device) throw new Error("WebGPU device not found.");
        this.adapter = adapter; this.device = device;
        this.workgroup_size_pow = workgroup_size_pow;
        const workgroup_size = 1 << workgroup_size_pow;
        this.maxSize = Math.min(adapter.limits.maxStorageBufferBindingSize, adapter.limits.maxBufferSize);
        this.memUsed = 0;

        const shaderModule = device.createShaderModule({
            label: 'STFT Compute Shader',
            code: /*wgsl*/`
const fftN: u32 = ${this.fftN}u;// 实数FFT长度
const M: u32 = ${this.realN}u;// 复数FFT长度
const PI: f32 = 3.14159265359;
struct Config {
    audioLen: u32,
    hop: u32,
    numFrames: u32,
    initialOffset_stage: i32,   // 第一阶段作为音频起始位置偏移 第二阶段作为stage
};
@group(0) @binding(0) var<storage, read_write> audio: array<f32>;// 音频输入
@group(0) @binding(1) var<storage, read_write> complexData: array<vec2<f32>>;// 复数中间结果 [numFrames * M]
@group(0) @binding(2) var<uniform> config: Config;
@group(0) @binding(3) var<storage, read> bitReverseLUT: array<u32>;// 位反转查找表 [M]
@group(0) @binding(4) var<storage, read_write> energyOutput: array<f32>;// 能量谱输出 [numFrames * M]

fn hanning(n: u32) -> f32 {return 1 - cos(PI * f32(n) / f32(M));}

// Pass1 预处理阶段：加窗并填充复数数组
@compute @workgroup_size(${workgroup_size})
fn preprocess(
    // 对于8192点, dispatch(8192/(256*2), numFrames, 1)
    @builtin(global_invocation_id) global_id: vec3<u32> // (x: n within frame, y: frame index)
) {
    let n = global_id.x; // range [0, 4095]
    let frame = global_id.y;
    let offset = i32(frame * config.hop) + config.initialOffset_stage;   // 本帧的音频起始位置
    // 取音频数据，越界补零
    let idx_even = offset + i32(n * 2);
    let idx_odd = idx_even + 1;
    let re = select(0.0, audio[u32(idx_even)], idx_even >= 0 && u32(idx_even) < config.audioLen);
    let im = select(0.0, audio[u32(idx_odd)], idx_odd >= 0 && u32(idx_odd) < config.audioLen);
    // 加窗并构成复数
    let win_even = hanning(n << 1u);
    let win_odd = hanning((n << 1u) + 1u);
    complexData[frame * M + n] = vec2<f32>(re * win_even, im * win_odd);
}

// Pass2 FFT计算阶段 config.initialOffset_stage (即 stage) 应该从 LOG2_M - 1 (11) 循环递减到 0
@compute @workgroup_size(${workgroup_size})
fn fft_stage(
    // dispatch(2048/256, numFrames, 1)
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let n = global_id.x; // range [0, 2047] 一个线程处理一个蝶形
    let frame = global_id.y;
    let stage = u32(config.initialOffset_stage);   // 作为stage使用

    let step = 1u << stage; // 步长: 2048, 1024, ..., 1
    let element_count = step << 1u;  // 当前块大小

    let blockIdx = n / step; // n*2 / element_count
    let offsetInBlock = n % step;

    // 旋转因子 W 计算
    let tIndex = offsetInBlock * (M >> (stage + 1u));
    let angle = -2.0 * PI * f32(tIndex) / f32(M);
    let w = vec2<f32>(cos(angle), sin(angle));

    let index1 = frame * M + (blockIdx * element_count + offsetInBlock);
    let index2 = index1 + step;
    let u = complexData[index1];
    let v = complexData[index2];

    let sub = u - v;
    let out2 = vec2<f32>(
        sub.x * w.x - sub.y * w.y,
        sub.x * w.y + sub.y * w.x
    );
    complexData[index1] = u + v;
    complexData[index2] = out2;
}

// Pass3 位反转 RealFFT后处理 能量谱
@compute @workgroup_size(${workgroup_size})
fn postprocess(
    // dispatch(4096/256, numFrames, 1)
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    let k = global_id.x; // [0, M-1]
    let frame = global_id.y;

    // 1. 读取 Bit-Reversed 数据，恢复线性顺序的 Z[k]
    let revK = bitReverseLUT[k];
    let Z_k = complexData[frame * M + revK];

    // 2. 获取对称点 Z[N/2 - k]
    // 注意处理 k=0 的情况, (M-0)%M = 0
    let k_sym = (M - k) % M;
    let revK_sym = bitReverseLUT[k_sym];
    let Z_sym = complexData[frame * M + revK_sym];

    // 3. Unscramble 公式
    let Z_sym_conj = vec2<f32>(Z_sym.x, -Z_sym.y);
    let F_even = 0.5 * (Z_k + Z_sym_conj);
    let F_odd  = 0.5 * (Z_k - Z_sym_conj);
    let angle = -PI * f32(k) / f32(M);
    let w = vec2<f32>(cos(angle), sin(angle));
    let neg_j_F_odd = vec2<f32>(F_odd.y, -F_odd.x);// -j * Fodd
    let rot_F_odd = vec2<f32>(// -j * Fodd * w
        neg_j_F_odd.x * w.x - neg_j_F_odd.y * w.y,
        neg_j_F_odd.x * w.y + neg_j_F_odd.y * w.x
    );
    let X_k = F_even + rot_F_odd;

    // 4. 计算能量谱
    let energy = X_k.x * X_k.x + X_k.y * X_k.y;

    // 累加
    let outIdx = frame * M + k;
    energyOutput[outIdx] = energyOutput[outIdx] + energy;
}`});
        const bindGroupLayout = this.bindGroupLayout = device.createBindGroupLayout({
            label: "STFT Uniform Layout",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
            ]
        });
        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        });

        this.prePipeLine = device.createComputePipeline({
            label: "STFT Preprocess Pipeline",
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: "preprocess" },
        });
        this.fftPipeLine = device.createComputePipeline({
            label: "STFT FFT Pipeline",
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: "fft_stage" },
        });
        this.postPipeline = device.createComputePipeline({
            label: "STFT Postprocess Pipeline",
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: "postprocess" },
        });
        // 位反转缓冲区
        const bitReverseLUTBuffer = this.bitReverseLUTBuffer = device.createBuffer({
            size: this.realN * Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Uint32Array(bitReverseLUTBuffer.getMappedRange()).set(STFTGPU.reverseBits(this.realN));
        bitReverseLUTBuffer.unmap();
        // 配置缓冲区
        this.configBuffer ??= device.createBuffer({
            size: 4 * Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.memUsed += bitReverseLUTBuffer.size + this.configBuffer.size;
        if (this.memUsed > this.maxSize) throw new Error("STFTGPU: Exceeded maximum buffer size.");
    }
    stft(audioBuffer) {
        // 第一帧的左侧 一般为负数
        const initialOffset = (this.hopSize >> 1) - this.realN;
        const audioLen = audioBuffer.length;
        const numFrames = 1 + (audioLen - 1 - (this.hopSize >> 1)) / this.hopSize | 0;
        const bytes = numFrames * this.realN * Float32Array.BYTES_PER_ELEMENT;
        // 输入
        const audioBufferGPU = this.audioBufferGPU ??= this.device.createBuffer({
            size: audioBuffer.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        // 中间变量
        const complexDataBuffer = this.complexDataBuffer ??= this.device.createBuffer({
            size: bytes << 1,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
        });
        // 输出
        const outputBuffer = this.outputBuffer ??= this.device.createBuffer({
            size: bytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        // 检查空间
        this.memUsed += audioBufferGPU.size + complexDataBuffer.size + outputBuffer.size;
        if (this.memUsed > this.maxSize) throw new Error("STFTGPU: Exceeded maximum buffer size.");
        // 写入数据
        this.device.queue.writeBuffer(audioBufferGPU, 0, audioBuffer);
        this.device.queue.writeBuffer(this.configBuffer, 0, new Int32Array([
            audioLen, this.hopSize, numFrames, initialOffset
        ]));
        // 创建统一的BindGroup
        const mainBindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: audioBufferGPU } },
                { binding: 1, resource: { buffer: complexDataBuffer } },
                { binding: 2, resource: { buffer: this.configBuffer } },
                { binding: 3, resource: { buffer: this.bitReverseLUTBuffer } },
                { binding: 4, resource: { buffer: outputBuffer } },
            ],
        });

        // === 预处理 ===
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder1 = commandEncoder.beginComputePass();
        passEncoder1.setPipeline(this.prePipeLine);
        passEncoder1.setBindGroup(0, mainBindGroup);
        passEncoder1.dispatchWorkgroups(this.realN >> this.workgroup_size_pow, numFrames, 1);
        passEncoder1.end();
        this.device.queue.submit([commandEncoder.finish()]);
        // === FFT计算 ===
        const LOG2_M = Math.log2(this.realN);
        for (let stage = LOG2_M - 1; stage >= 0; stage--) {
            const commandEncoder = this.device.createCommandEncoder();
            const passEncoder2 = commandEncoder.beginComputePass();
            passEncoder2.setPipeline(this.fftPipeLine);
            // 更新stage
            this.device.queue.writeBuffer(this.configBuffer, 3 * Uint32Array.BYTES_PER_ELEMENT, new Int32Array([stage]));
            passEncoder2.setBindGroup(0, mainBindGroup);
            passEncoder2.dispatchWorkgroups(this.realN >> (this.workgroup_size_pow + 1), numFrames, 1);
            passEncoder2.end();
            this.device.queue.submit([commandEncoder.finish()]);
        }
        // === 后处理 ===
        const commandEncoder3 = this.device.createCommandEncoder();
        const passEncoder3 = commandEncoder3.beginComputePass();
        passEncoder3.setPipeline(this.postPipeline);
        passEncoder3.setBindGroup(0, mainBindGroup);
        passEncoder3.dispatchWorkgroups(this.realN >> this.workgroup_size_pow, numFrames, 1);
        passEncoder3.end();
        this.device.queue.submit([commandEncoder3.finish()]);
    }
    readGPU(buffer = this.outputBuffer) {
        const readBuffer = this.device.createBuffer({
            size: buffer.size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(buffer, 0, readBuffer, 0, buffer.size);
        this.device.queue.submit([commandEncoder.finish()]);
        return readBuffer.mapAsync(GPUMapMode.READ).then(() => {
            const arrayBuffer = new Float32Array(readBuffer.getMappedRange()).slice();
            readBuffer.unmap();
            readBuffer.destroy();
            const result = Array(arrayBuffer.length / this.realN);
            for (let i = 0, offset = 0; i < arrayBuffer.length; i += this.realN, offset++) {
                result[offset] = arrayBuffer.slice(i, i + this.realN);
            } return result;
        });
    }
    free() {
        this.audioBufferGPU?.destroy();this.audioBufferGPU = null;
        this.complexDataBuffer?.destroy();this.complexDataBuffer = null;
        this.outputBuffer?.destroy();this.outputBuffer = null;
        this.bitReverseLUTBuffer?.destroy();this.bitReverseLUTBuffer = null;
        this.configBuffer?.destroy();this.configBuffer = null;
        this.prePipeLine = null;this.fftPipeLine = null;this.postPipeline = null;
        this.device = null;this.adapter = null;
        this.bindGroupLayout = null;
    }
}