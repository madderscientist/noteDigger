class FreqTable extends Float32Array {
    constructor(A4 = 440) {
        super(84);  // 范围是C1-B7
        this.A4 = A4;
    }
    set A4(A4) {
        let Note4 = [
            A4 * 0.5946035575013605, A4 * 0.6299605249474366,
            A4 * 0.6674199270850172, A4 * 0.7071067811865475,
            A4 * 0.7491535384383408,
            A4 * 0.7937005259840998, A4 * 0.8408964152537146,
            A4 * 0.8908987181403393, A4 * 0.9438743126816935,
            A4, A4 * 1.0594630943592953,
            A4 * 1.122462048309373
        ];
        this.set(Note4.map(v => v / 8), 0);
        this.set(Note4.map(v => v / 4), 12);
        this.set(Note4.map(v => v / 2), 24);
        this.set(Note4, 36);
        this.set(Note4.map(v => v * 2), 48);
        this.set(Note4.map(v => v * 4), 60);
        this.set(Note4.map(v => v * 8), 72);
    }
    get A4() {
        return this[45];
    }
}

class NoteAnalyser {    // 负责解析频谱数据
    /**
     * @param {number} df FFT的频率分辨率
     * @param {FreqTable || Number} freq 频率表(将被引用)或中央A的频率
     */
    constructor(df, freq) {
        this.df = df;
        if (typeof freq === 'number') {
            this.freqTable = new FreqTable(freq);
        } else {
            this.freqTable = freq;
        } this.updateRange();
    }
    set A4(freq) {
        this.freqTable.A4 = freq;
        this.updateRange();
    }
    get A4() {
        return this.freqTable.A4;
    }
    /**
     * 创建从线性谱到CQ谱的加权矩阵
     * @param {number} semiR 每个半音收集的频率范围 单位:半音 取1的时候半音间无重合
     * @param {number} leakR 频谱泄露半径 单位:每FFT精度
     * @param {number} oversample 过采样率 用于模拟泄露
     */
    updateRange(semiR = 0.667, leakR = 1, oversample = 32) {
        const win = this.win = Array(this.freqTable.length);
        const offset = this.offset = new Uint16Array(this.freqTable.length);

        // 用余弦模拟FFT的频率泄漏(FFT使用hanning窗)
        const H_fft = new Float32Array((oversample << 1) | 1);
        // 跳过两端的0
        for (let i = 0, j = H_fft.length - 1, w = Math.PI / (oversample + 1); i < oversample; i++, j--) {
            H_fft[i] = H_fft[j] = (1 - Math.cos((i + 1) * w)) * 0.5;
        } H_fft[oversample] = 1;
        const over_df = this.df * leakR / (oversample + 1);

        // 用对数谱的余弦收集能量 新坐标u=B*log2(x/center) B=12
        // du/dx = B/log(2)/x 每Hz对应的半音数 代表占据能量的宽度
        const omega = Math.PI / semiR;
        function pitchCospuls(x, center) {
            if (x <= 0) return 0;
            let wrapedf = 12 * Math.log2(x / center);   // 半音距离
            if (Math.abs(wrapedf) >= semiR) return 0;
            // 余弦窗*du/dx 余弦周期为2表示相邻半音 常数项不管 会归一化
            return (Math.cos(wrapedf * omega) + 1) / x;
        }

        const tuning = 1.0594630943592953;  // 2^(1/12)
        for (let i = 0; i < offset.length; i++) {
            let fc = this.freqTable[i];
            let start = this.freqTable[i - 1] ?? fc / tuning;
            let end = this.freqTable[i + 1] ?? fc * tuning;
            start = offset[i] = (start / this.df) | 0;
            end = Math.ceil(end / this.df) + 1;
            const H = win[i] = new Float32Array(end - start);
            for (let j = start, id = 0; j < end; j++, id++) {
                // 对每个fft中心频点计算贡献: \sum 泄露*窗值
                for (let hid = 0, f = j * this.df - oversample * over_df; hid < H_fft.length; f += over_df, hid++)
                    H[id] += pitchCospuls(f, fc) * H_fft[hid];
            }
            // 幅度一致性: 频率越高窗越大
            for (let j = 0; j < H.length; j++) H[j] *= fc;
        }
    }
    /**
     * 从FFT提取音符的频谱 原理是区间内求和
     * @param {Float32Array} real 实部
     * @param {Float32Array} imag 虚部
     * @param {Float32Array} buffer 可选的缓冲区 避免重复分配
     * @returns {Float32Array} 音符的幅度谱
     */
    mel(real, imag, buffer = null) {
        const noteAm = buffer ?? new Float32Array(84);
        for (let i = 0; i < this.freqTable.length; i++) {
            const H = this.win[i];
            const offset = this.offset[i];
            for (let j = 0; j < H.length; j++) {
                const eng = real[offset + j] * real[offset + j] + imag[offset + j] * imag[offset + j];
                noteAm[i] += eng * H[j];
            }
        } return noteAm;
    }
    // 上面函数的平方和版本
    mel2(eng, buffer = null) {
        const noteAm = buffer ?? new Float32Array(84);
        for (let i = 0; i < this.freqTable.length; i++) {
            const H = this.win[i];
            const offset = this.offset[i];
            for (let j = 0; j < H.length; j++) {
                noteAm[i] += eng[offset + j] * H[j];
            }
        } return noteAm;
    }
    /**
     * 能量谱归一化
     * @param {Array<Float32Array>} engSpectrum 能量谱 每个元素未开方
     */
    static normalize(engSpectrum) {
        // 求每一帧的能量
        let energySum = 0;
        let frameEnergy = new Float32Array(engSpectrum.length);
        for (let t = 0; t < engSpectrum.length; t++) {
            const frame = engSpectrum[t];
            for (let i = 0; i < frame.length; i++)
                frameEnergy[t] += frame[i];
            energySum += frameEnergy[t];
        }
        // 计算能量方差
        let sigma = 1e-8;
        const meanEnergy = energySum / engSpectrum.length;
        for (let t = 0; t < engSpectrum.length; t++) {
            const delta = frameEnergy[t] - meanEnergy;
            sigma += delta * delta;
        }
        sigma = Math.sqrt(sigma / engSpectrum.length);
        // 归一化
        for (const frame of engSpectrum) {
            for (let i = 0; i < frame.length; i++)
                frame[i] = Math.sqrt(frame[i] / sigma);
        } return engSpectrum;
    }
    /**
     * 调性分析，原理是音符能量求和
     * @param {Array<Float32Array>} noteTable
     * @returns {Array<String, Float32Array>} 调性和音符的能量
     */
    static Tonality(noteTable) {
        let energy = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (const atime of noteTable) {
            energy[0] += atime[0] ** 2 + atime[12] ** 2 + atime[24] ** 2 + atime[36] ** 2 + atime[48] ** 2 + atime[60] ** 2 + atime[72] ** 2;
            energy[1] += atime[1] ** 2 + atime[13] ** 2 + atime[25] ** 2 + atime[37] ** 2 + atime[49] ** 2 + atime[61] ** 2 + atime[73] ** 2;
            energy[2] += atime[2] ** 2 + atime[14] ** 2 + atime[26] ** 2 + atime[38] ** 2 + atime[50] ** 2 + atime[62] ** 2 + atime[74] ** 2;
            energy[3] += atime[3] ** 2 + atime[15] ** 2 + atime[27] ** 2 + atime[39] ** 2 + atime[51] ** 2 + atime[63] ** 2 + atime[75] ** 2;
            energy[4] += atime[4] ** 2 + atime[16] ** 2 + atime[28] ** 2 + atime[40] ** 2 + atime[52] ** 2 + atime[64] ** 2 + atime[76] ** 2;
            energy[5] += atime[5] ** 2 + atime[17] ** 2 + atime[29] ** 2 + atime[41] ** 2 + atime[53] ** 2 + atime[65] ** 2 + atime[77] ** 2;
            energy[6] += atime[6] ** 2 + atime[18] ** 2 + atime[30] ** 2 + atime[42] ** 2 + atime[54] ** 2 + atime[66] ** 2 + atime[78] ** 2;
            energy[7] += atime[7] ** 2 + atime[19] ** 2 + atime[31] ** 2 + atime[43] ** 2 + atime[55] ** 2 + atime[67] ** 2 + atime[79] ** 2;
            energy[8] += atime[8] ** 2 + atime[20] ** 2 + atime[32] ** 2 + atime[44] ** 2 + atime[56] ** 2 + atime[68] ** 2 + atime[80] ** 2;
            energy[9] += atime[9] ** 2 + atime[21] ** 2 + atime[33] ** 2 + atime[45] ** 2 + atime[57] ** 2 + atime[69] ** 2 + atime[81] ** 2;
            energy[10] += atime[10] ** 2 + atime[22] ** 2 + atime[34] ** 2 + atime[46] ** 2 + atime[58] ** 2 + atime[70] ** 2 + atime[82] ** 2;
            energy[11] += atime[11] ** 2 + atime[23] ** 2 + atime[35] ** 2 + atime[47] ** 2 + atime[59] ** 2 + atime[71] ** 2 + atime[83] ** 2;
        }
        // notes根据最大值归一化
        let max = Math.max(...energy);
        energy = energy.map((num) => num / max);
        // 找到最大的前7个音符
        const sortedIndices = energy.map((num, index) => index)
            .sort((a, b) => energy[b] - energy[a])
            .slice(0, 7);
        sortedIndices.sort((a, b) => a - b);
        // 判断调性
        let tonality = sortedIndices.map((num) => {
            return num.toString(16);
        }).join('');
        switch (tonality) {
            case '024579b': tonality = 'C'; break;
            case '013568a': tonality = 'C#'; break;
            case '124679b': tonality = 'D'; break;
            case '023578a': tonality = 'Eb'; break;
            case '134689b': tonality = 'E'; break;
            case '024579a': tonality = 'F'; break;
            case '13568ab': tonality = 'Gb'; break;
            case '024679b': tonality = 'G'; break;
            case '013578a': tonality = 'Ab'; break;
            case '124689b': tonality = 'A'; break;
            case '023579a': tonality = 'Bb'; break;
            case '13468ab': tonality = 'B'; break;
            default: tonality = 'Unknown'; break;
        } return [tonality, energy];
    }
    /**
     * 标记大于阈值的音符
     * @param {Array<Float32Array>} noteTable 时频图
     * @param {number} threshold 阈值
     * @param {number} from 
     * @param {number} to 
     * @returns {Array<Note>} {x1,x2,y,ch,selected}
     */
    static autoFill(noteTable, threshold, from = 0, to = 0) {
        let notes = [];
        let lastAt = new Uint16Array(noteTable[0].length).fill(65535);
        let time = from;   // 迭代器指示
        if (!to || to > noteTable.length) to = noteTable.length;
        for (; time < to; time++) {
            const t = noteTable[time];
            for (let i = 0; i < lastAt.length; i++) {
                let now = t[i] < threshold; // 现在不达标
                if (lastAt[i] != 65535) {
                    if (now) {
                        notes.push({   // 上一次有但是这次没有
                            y: i,
                            x1: lastAt[i],
                            x2: time,
                            ch: -1, selected: false
                        }); lastAt[i] = 65535;
                    }
                } else if (!now) lastAt[i] = time;  // 上次没有这次有
            }
        }
        // 扫尾
        for (let i = 0; i < lastAt.length; i++) {
            if (lastAt[i] != 65535) notes.push({
                y: i,
                x1: lastAt[i],
                x2: time,
                ch: -1, selected: false
            });
        } return notes;
    }
}