/**
 * 目前我写的最快的实数FFT。为音乐频谱分析设计
 */
class realFFT {
    /**
     * 位反转数组 最大支持2^16点
     * @param {number} N 2的正整数幂
     * @returns {Uint16Array} 位反转序列
     */
    static reverseBits(N) {
        const reverseBits = new Uint16Array(N); // 实际N最大2^15
        reverseBits[0] = 0;
        // 计算位数
        let bits = 15;
        while ((1 << bits) > N) bits--;
        // 由于是实数FFT，偶次为实部，奇次为虚部，故最终结果要乘2，所以不是16-bits
        bits = 15 - bits;
        for (let i = 1; i < N; i++) {
            // 基于二分法的位翻转
            let r = ((i & 0xaaaa) >> 1) | ((i & 0x5555) << 1);
            r = ((r & 0xcccc) >> 2) | ((r & 0x3333) << 2);
            r = ((r & 0xf0f0) >> 4) | ((r & 0x0f0f) << 4);
            reverseBits[i] = ((r >> 8) | (r << 8)) >> bits;
        } return reverseBits;
    }
    /**
     * 复数乘法
     * @param {number} a 第一个数的实部
     * @param {number} b 第一个数的虚部
     * @param {number} c 第二个数的实部
     * @param {number} d 第二个数的虚部
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
     * 初始化实数FFT 使用Hanning窗
     * @param {number} N 要做几点的实数FFT
     * @param {string} window 窗类型 'hanning' | 'none'
     */
    constructor(N, window = 'hanning') {
        this.ini(N);
        this.bufferr = new Float32Array(this.N);
        this.bufferi = new Float32Array(this.N);
        // 存放最终结果的数组
        // FFT返回Xr和Xi IFFT返回X
        this.X = new Float32Array(this.N << 1);
        this.Xr = this.X.subarray(0, this.N);
        this.Xi = this.X.subarray(this.N);
        // 窗函数初始化
        if (window === 'hanning') this.initWindow();
        else this.window = new Float32Array(this.N << 1).fill(1);
    }
    /**
     * 计算Hanning窗
     * 并利用this.bufferr和this.bufferi对窗值进行重排
     * 以加速FFT时的访问速度（随机访问->顺序访问）
     */
    initWindow() {
        // this.N是实际长度的一半
        const half_N = this.N;
        const N = this.N << 1;
        const pi2_N = Math.PI / half_N; // 2π/N = π/(N/2)
        for (let n = 0; n < half_N; n++) {
            // 利用对称性 由于最后会归一化，因此这里不用除以2
            this.bufferr[n] = this.bufferi[half_N - n - 1] = 1 - Math.cos(pi2_N * n);
        }
        const window = new Float32Array(N);
        for (let i = 0, ii = 1, j = 0; j < N; i += 2, ii += 2, j += 4) {
            // 利用性质：reverseBits的偶数项都小于half_N（从bufferr中取值），奇数项都大于half_N（从bufferi中取值）
            window[j] = this.bufferr[this.reverseBits[i]];
            window[j+1] = this.bufferr[this.reverseBits[i] + 1];
            window[j+2] = this.bufferi[this.reverseBits[ii] - half_N];
            window[j+3] = this.bufferi[this.reverseBits[ii] - half_N + 1];
        }
        this.window = window;
    }
    /**
     * 预计算常量
     * @param {number} N 2的正整数次幂
     */
    ini(N) {
        // 确定FFT长度
        N = 1 << (Math.ceil(Math.log2(N)) - 1);
        this.N = N;     // 存的是实际FFT的点数
        // 位反转预计算 实际做N/2的FFT
        this.reverseBits = realFFT.reverseBits(N);
        // 旋转因子预计算 仍然需要N点的，但是只取前一半
        const PIN = Math.PI / N;
        this._Wr = new Float32Array(Array.from({ length: N }, (_, i) => Math.cos(PIN * i)));
        this._Wi = new Float32Array(Array.from({ length: N }, (_, i) => -Math.sin(PIN * i)));
    }
    /**
     * 计算除第一层外的FFT
     * 要求第一层的结果存储于this.bufferr和this.bufferi
     * 结果存储于this.bufferr和this.bufferi
     */
    _fftOther() {
        for (let groupNum = this.N >> 2, groupMem = 2; groupNum; groupNum >>= 1) {
            // groupNum: 组数；groupMem：一组里有几个蝶形结构，同时也是一个蝶形结构两个元素的序号差值
            // groupNum: N/4,  N/8, ...,    1
            // groupMem: 2,    4,   ...,    N/2
            // W's base: 4,    8,   ...,    N
            // W's base desired: 2N
            // times to k: N/2, N/4 --> equals to 2*groupNum (W_base*k_times=W_base_desired)
            // offset between groups: 4, 8, ..., N --> equals to 2*groupMem
            const groupOffset = groupMem << 1;
            for (let mem = 0, k = 0, dk = groupNum << 1; mem < groupMem; mem++, k += dk) {
                const [Wr, Wi] = [this._Wr[k], this._Wi[k]];
                for (let gn = mem; gn < this.N; gn += groupOffset) {
                    const gn2 = gn + groupMem;
                    const [gwr, gwi] = realFFT.ComplexMul(this.bufferr[gn2], this.bufferi[gn2], Wr, Wi);
                    this.Xr[gn] = this.bufferr[gn] + gwr;
                    this.Xi[gn] = this.bufferi[gn] + gwi;
                    this.Xr[gn2] = this.bufferr[gn] - gwr;
                    this.Xi[gn2] = this.bufferi[gn] - gwi;
                }
            }
            [this.bufferr, this.bufferi, this.Xr, this.Xi] = [this.Xr, this.Xi, this.bufferr, this.bufferi];
            groupMem = groupOffset;
        }
    }
    /**
     * 输入N点实数，输出N/2点复数FFT结果；X[0]的实部存放于Xi[0]
     * @param {Float32Array} input 输入
     * @param {number} offset 偏移量
     * @returns [实部, 虚部]
     */
    fft(input, offset = 0) {
        // 偶数次和奇数次组合并计算第一层 并加窗
        for (let i = 0, ii = 1, j = 0, offseti = offset + 1; i < this.N; i += 2, ii += 2, j += 4) {
            let xr1 = input[this.reverseBits[i] + offset] || 0;
            let xi1 = input[this.reverseBits[i] + offseti] || 0;
            let xr2 = input[this.reverseBits[ii] + offset] || 0;
            let xi2 = input[this.reverseBits[ii] + offseti] || 0;
            xr1 *= this.window[j];
            xi1 *= this.window[j+1];
            xr2 *= this.window[j+2];
            xi2 *= this.window[j+3];
            this.bufferr[i] = xr1 + xr2;
            this.bufferi[i] = xi1 + xi2;
            this.bufferr[ii] = xr1 - xr2;
            this.bufferi[ii] = xi1 - xi2;
        }
        // 其他层
        this._fftOther();
        // 合并为实数FFT的结果
        this.Xr[0] = this.bufferr[0] + this.bufferi[0];
        this.Xi[0] = this.bufferr[0] - this.bufferi[0]; // 实际上是X[N/2]的实部
        for (let k = 1, Nk = this.N - 1; Nk; k++, Nk--) {
            const [Ir, Ii] = realFFT.ComplexMul(this.bufferi[k] + this.bufferi[Nk], this.bufferr[Nk] - this.bufferr[k], this._Wr[k], this._Wi[k]);
            this.Xr[k] = (this.bufferr[k] + this.bufferr[Nk] + Ir) * 0.5;
            this.Xi[k] = (this.bufferi[k] - this.bufferi[Nk] + Ii) * 0.5;
        }
        return [this.Xr, this.Xi];
    }
    /**
     * 输入N/2点复数频域，输出N点实数时域
     * @param {Float32Array} real 频域实部
     * @param {Float32Array} imag 频域虚部 imag[0]存放X[N/2]的实部
     * @returns {Float32Array} 时域实数
     */
    ifft(real, imag) {
        const calci = (idx) => {
            const xr = real[idx] || 0;
            const xi = imag[idx] || 0;
            const xrN = real[this.N - idx] || 0;
            const xiN = imag[this.N - idx] || 0;
            const [r, i] = realFFT.ComplexMul(xr - xrN, xi + xiN, this._Wi[idx], this._Wr[idx]);
            // 先不乘0.5 到最后归一化再做
            return [xr + xrN + r, xi - xiN + i];
        }
        // 拼接并计算第一层
        {   // 单独计算第一组
            const x1r = real[0] + imag[0];
            const x1i = real[0] - imag[0];
            // reverseBits为了适应FFT乘了2 这里要除回去
            const [x2r, x2i] = calci(this.reverseBits[1] >> 1);
            this.bufferr[0] = x1r + x2r;
            this.bufferr[1] = x1r - x2r;
            // IFFT需要取共轭
            this.bufferi[0] = -(x1i + x2i);
            this.bufferi[1] = x2i - x1i;
        }
        for (let i = 2, ii = 3; i < this.N; i+=2, ii+=2) {
            const [x1r, x1i] = calci(this.reverseBits[i] >> 1);
            const [x2r, x2i] = calci(this.reverseBits[ii] >> 1);
            this.bufferr[i] = x1r + x2r;
            this.bufferr[ii] = x1r - x2r;
            this.bufferi[i] = -(x1i + x2i);
            this.bufferi[ii] = x2i - x1i;
        }
        // 其他层
        this._fftOther();
        // 结果重排并归一化
        const norm = 1 / (this.N << 1);     // 之前的0.5
        for (let i = 0, j = 0; i < this.N; i++, j+=2) {
            this.X[j] = this.bufferr[i] * norm;
            this.X[j + 1] = -this.bufferi[i] * norm;    // 取共轭
        }
        return this.X;
    }
}