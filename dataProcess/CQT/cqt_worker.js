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
    constructor(fs, fmin = 32.7, octaves = 7, bins_per_octave = 12, filter_scale = 1) {
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
            const temp_kernel_r = kernel_r[i] = new Float32Array(len);
            const temp_kernel_i = kernel_i[i] = new Float32Array(len);
            const window = CQT.blackmanHarris(len);
            const omega = 2 * Math.PI * freq / fs;
            const half_len = len >> 1;
            for (let j = 0; j < len; j++) {
                const angle = omega * (j - half_len);   // 中心的相位为0
                temp_kernel_r[j] = Math.cos(angle) * window[j];
                temp_kernel_i[j] = Math.sin(angle) * window[j]; // 按DFT应该加负号，但是最后的结果是能量，加不加都一样
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
        const output_length = Math.ceil((x.length - offset) / stride);
        const output = Array(output_length);
        const frameEnergy = new Float32Array(output_length);
        let pointer = 0;
        let energySum = 0;
        for (; offset < x.length; offset += stride) {
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
                    if (index >= x.length) break;
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
}

self.onmessage = async ({data}) => {
    let { audioChannel, sampleRate, hop, fmin } = data;
    const cqt = new CQT(sampleRate, fmin, 7, 12, 2.8);
    let cqtData = cqt.cqt(audioChannel[0], hop);
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
    self.postMessage(cqtData, [...cqtData.map(x => x.buffer), ...audioChannel.map(x => x.buffer)]);
    self.close();
};
