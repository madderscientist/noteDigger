/**
 * 目前我写的最快的实数FFT。为音乐频谱分析设计
 */
class realFFT {
    /**
     * 位反转数组 最大支持2^16点
     * @param {Number} N 2的正整数幂
     * @returns {[Uint16Array, Uint8Array]} 根据N的大小决定的位反转结果
     */
    static reverseBits(N) {
        const reverseBits = new Uint16Array(N); // 实际N最大2^15
        let id = 0;
        function _fft(offset, step, N) {
            if (N == 2) {
                // 由于是实数FFT，偶次为实部，奇次为虚部，故布局为2
                reverseBits[id++] = offset << 1;
                reverseBits[id++] = (offset + step) << 1;
                return;
            }
            let step2 = step << 1;
            N >>= 1;
            _fft(offset, step2, N);
            _fft(offset + step, step2, N);
        }
        _fft(0, 1, N);
        return reverseBits;
    }
    /**
     * 复数乘法
     * @param {Number} a 第一个数的实部
     * @param {Number} b 第一个数的虚部
     * @param {Number} c 第二个数的实部
     * @param {Number} d 第二个数的虚部
     * @returns {Array} [实部, 虚部]
     */
    static ComplexMul(a = 0, b = 0, c = 0, d = 0) {
        return [a * c - b * d, a * d + b * c];
    }
    /**
     * 计算复数的幅度
     * @param {Float32Array} r 实部数组
     * @param {Float32Array} i 虚部数组
     * @returns {Float32Array} 幅度
     */
    static ComplexAbs(r, i, l) {
        l = l || r.length;
        const ABS = new Float32Array(l);
        for (let j = 0; j < l; j++) {
            ABS[j] = Math.sqrt(r[j] * r[j] + i[j] * i[j]);
        } return ABS;
    }

    /**
     * 
     * @param {Number} N 要做几点的实数FFT
     */
    constructor(N) {
        this.ini(N);
        this.bufferr = new Float32Array(this.N);
        this.bufferi = new Float32Array(this.N);
        this.Xr = new Float32Array(this.N);
        this.Xi = new Float32Array(this.N);
    }
    /**
     * 预计算常量
     * @param {Number} N 2的正整数次幂
     */
    ini(N) {
        // 确定FFT长度
        N = Math.pow(2, Math.ceil(Math.log2(N)) - 1);
        this.N = N;     // 存的是实际FFT的点数
        // 位反转预计算 实际做N/2的FFT
        this.reverseBits = realFFT.reverseBits(N);
        // 旋转因子预计算 仍然需要N点的，但是只取前一半
        this._Wr = new Float32Array(Array.from({ length: N }, (_, i) => Math.cos(Math.PI / N * i)));
        this._Wi = new Float32Array(Array.from({ length: N }, (_, i) => -Math.sin(Math.PI / N * i)));
    }
    /**
     * 
     * @param {Float32Array} input 输入
     * @param {Number} offset 偏移量
     * @returns [实部, 虚部]
     */
    fft(input, offset = 0) {
        // 偶数次和奇数次组合并计算第一层
        for (let i = 0, ii = 1, offseti = offset + 1; i < this.N; i += 2, ii += 2) {
            let xr1 = input[this.reverseBits[i] + offset] || 0;
            let xi1 = input[this.reverseBits[i] + offseti] || 0;
            let xr2 = input[this.reverseBits[ii] + offset] || 0;
            let xi2 = input[this.reverseBits[ii] + offseti] || 0;
            this.bufferr[i] = xr1 + xr2;
            this.bufferi[i] = xi1 + xi2;
            this.bufferr[ii] = xr1 - xr2;
            this.bufferi[ii] = xi1 - xi2;
        }
        for (let groupNum = this.N >> 2, groupMem = 2; groupNum; groupNum >>= 1) {
            // groupNum: 组数；groupMem：一组里有几个蝶形结构，同时也是一个蝶形结构两个元素的序号差值
            // groupNum: N/4,  N/8, ...,    1
            // groupMem: 2,    4,   ...,    N/2
            // W's base: 4,    8,   ...,    N
            // W's base desired: 2N
            // times to k: N/2, N/4 --> equals to 2*groupNum (W_base*k_times=W_base_desired)
            // offset between groups: 4, 8, ..., N --> equals to 2*groupMem
            let groupOffset = groupMem << 1;
            for (let mem = 0, k = 0, dk = groupNum << 1; mem < groupMem; mem++, k += dk) {
                let [Wr, Wi] = [this._Wr[k], this._Wi[k]];
                for (let gn = mem; gn < this.N; gn += groupOffset) {
                    let gn2 = gn + groupMem;
                    let [gwr, gwi] = realFFT.ComplexMul(this.bufferr[gn2], this.bufferi[gn2], Wr, Wi);
                    this.Xr[gn] = this.bufferr[gn] + gwr;
                    this.Xi[gn] = this.bufferi[gn] + gwi;
                    this.Xr[gn2] = this.bufferr[gn] - gwr;
                    this.Xi[gn2] = this.bufferi[gn] - gwi;
                }
            }
            [this.bufferr, this.bufferi, this.Xr, this.Xi] = [this.Xr, this.Xi, this.bufferr, this.bufferi];
            groupMem = groupOffset;
        }
        // 合并为实数FFT的结果
        this.Xr[0] = this.bufferi[0] + this.bufferr[0];
        this.Xi[0] = 0;
        for (let k = 1, Nk = this.N - 1; Nk; k++, Nk--) {
            let [Ir, Ii] = realFFT.ComplexMul(this.bufferi[k] + this.bufferi[Nk], this.bufferr[Nk] - this.bufferr[k], this._Wr[k], this._Wi[k]);
            this.Xr[k] = (this.bufferr[k] + this.bufferr[Nk] + Ir) * 0.5;
            this.Xi[k] = (this.bufferi[k] - this.bufferi[Nk] + Ii) * 0.5;
        }
        return [this.Xr, this.Xi];
    }
}