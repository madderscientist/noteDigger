/**
 * @abstract 和弦识别类
 * 参考NNLS-Chroma这个Vamp插件,并做了简化(删去了NNLS&白化)与增强(乐理规则的转移概率调整)
 * 单帧和弦识别使用Chorma向量的余弦匹配(声学模型); 多帧使用HMM(语言模型)
 */
class ChordEst {
    /**
     * 和弦字典 包含和弦名称、和弦模板向量
     * @type {Array<{name: string, vec: Float32Array}>} with .raw as the raw buffer of all chord vecs concatenated together
     */
    chordDict; // [{name, chroma}]
    logPriorP; // 先验概率
    logTransP; // 转移概率
    states = []; // {scores: Float32Array, ptrs: Int16Array}
    /**
     * 构建和弦模板 转移概率
     * @param {number} harmonicDecay 谐波拟合的衰减
     * @param {number} P_N 无和弦的相对概率
     * @param {number} P_keep 保持当前和弦的概率
     */
    constructor(harmonicDecay = 0.3, P_N = 0.1, P_keep = 0.98) {
        class ChordPattern {
            static MIDI_NOTES = [0, 2, 4, 5, 7, 9, 11];
            static getMidi(je) {
                let base = 0, acci = 0;
                for (let char of je) {
                    if (char === 'b') acci -= 1;
                    else if (char === '#') acci += 1;
                    else base = ChordPattern.MIDI_NOTES[(parseInt(char) - 1) % 7] || 0;
                } return (base + acci + 12) % 12;
            }
            constructor(pattern, prob = 1.) {
                // this.pattern: [0, 4, 7]
                this.pattern = pattern.map(ChordPattern.getMidi);
                this.prob = prob;
            }
        }
        // 构建和弦字典
        const patternDict = {
            "": new ChordPattern(['1', '3', '5'], 1),    // 大三和弦 - 基础
            "m": new ChordPattern(['1', 'b3', '5'], 0.9),  // 小三和弦 - 基础
            "dim": new ChordPattern(['1', 'b3', 'b5'], 0.1),      // 减三 - 过渡性
            "aug": new ChordPattern(['1', '3', '#5'], 0.1),       // 增三 - 罕见色彩
            "sus4": new ChordPattern(['1', '4', '5'], 0.04),        // 挂四 - 过渡性和弦
            "sus2": new ChordPattern(['1', '2', '5'], 0.04),        // 挂二 - 现代流行
            "7": new ChordPattern(['1', '3', '5', 'b7'], 0.01),     // 属七 - 功能性强
            "m7": new ChordPattern(['1', 'b3', '5', 'b7'], 0.01),   // 小七 - 爵士/R&B常见
            "maj7": new ChordPattern(['1', '3', '5', '7'], 0.005),   // 大七 - 色彩性
            "dim7": new ChordPattern(['1', 'b3', 'b5', 'bb7'], 0.004),   // 减七 - 古典/爵士过渡
            "m7b5": new ChordPattern(['1', 'b3', 'b5', 'b7'], 0.003),   // 半减七 - 爵士ii级
            "add9": new ChordPattern(['1', '3', '5', '9'], 0.003),   // 加九 - 色彩性
            "mM7": new ChordPattern(['1', 'b3', '5', '7'], 0.001),  // 小大七 - 极罕见
            "maj9": new ChordPattern(['1', '3', '5', '7', '9'], 0.0002), // 大九 - 复杂
        };
        {   // 归一化概率
            let sum = 0;
            for (const ptn in patternDict) sum += patternDict[ptn].prob;
            sum = (1 - P_N) / (sum * 12);
            for (const ptn in patternDict) patternDict[ptn].prob *= sum;
        }
        const ptnKey = Object.keys(patternDict);
        const numPtn = ptnKey.length;
        const validChordNum = numPtn * 12;
        const chordNum = validChordNum + 1; // 包含无和弦

        [this.chordDict, this.logPriorP] = (() => {
            function initHarmonicTemplate(s = 0.6, harmonics = 9) {
                const a = new Float32Array(12);
                for (let h = 1, w = 1; h <= harmonics; h++, w *= s) {
                    let bin = Math.log2(h) * 12;
                    let l = Math.floor(bin);
                    let r = Math.ceil(bin);
                    let frac = bin - l;
                    a[l % 12] += w * (1 - frac);
                    a[r % 12] += w * frac;
                } return a;
            }
            const tmpl = initHarmonicTemplate(harmonicDecay);
            const Chord = (name, ptn, buf, amp = 1) => {
                // 施加谐波模板
                let sum = 0;
                for (let i = 0; i < 12; i++) {
                    for (let j = 0; j < 12; j++)
                        buf[i] += ptn[j] * tmpl[(i - j + 12) % 12];
                    sum += buf[i] * buf[i];
                }
                // 归一化
                sum = amp / Math.sqrt(sum);
                for (let i = 0; i < 12; i++) buf[i] *= sum;
                return { name, vec: buf };
            }

            const Roots = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
            const vec = new Float32Array(12);
            const result = Array(chordNum);
            const buffer = result.raw = new Float32Array(chordNum * 12);
            const priorP = new Float32Array(chordNum);
            const normAmp = { 4: 0.98, 5: 0.95, 6: 0.93 };
            let i = 0;
            // 存储结构: 相同模式的放一起
            for (const suffix of ptnKey) {
                const pattern = patternDict[suffix];
                priorP.fill(Math.log(pattern.prob), i, i + 12);
                const amp = normAmp[pattern.pattern.length];
                for (let root = 0; root < 12; root++) {
                    vec.fill(0);
                    for (const interval of pattern.pattern)
                        vec[(root + interval) % 12] = 1;
                    result[i] = Chord(Roots[root] + suffix, vec, buffer.subarray(i * 12, (i + 1) * 12), amp);
                    i++;
                }
            }
            // 无和弦
            result[i] = Chord("N", vec.fill(1), buffer.subarray(i * 12, (i + 1) * 12), 0.8);
            priorP[i] = Math.log(P_N);
            return [result, priorP];
        })();

        // 转移概率
        this.logTransP = ((P_STAY = P_keep) => {
            const getIdFromName = (nameList) => nameList.map(name => ptnKey.indexOf(name));
            const STABLE = getIdFromName(["", "m", "m7", "maj7", "add9", "maj9"]);
            const TENSION = getIdFromName(["7", "dim", "m7b5", "dim7", "aug", "mM7"]);
            const SUSPENSE = getIdFromName(["sus4", "sus2"]);

            const pMat = Array(chordNum);
            const lt = pMat.raw = new Float32Array(chordNum * chordNum);

            for (let i = 0; i < chordNum; i++) {
                const row = pMat[i] = lt.subarray(i * chordNum, (i + 1) * chordNum);
                if (i === validChordNum) {  // 从无和弦切换到别的状态
                    row.set(this.logPriorP);
                    this.logPriorP = row; // 复用
                    continue;
                }
                let sumScore = 0;
                let r1 = i % 12, p1 = i / 12 | 0;// 根音 模式
                // 遍历每一个转移的可能
                for (let j = 0; j < chordNum; j++) {
                    if (i === j) continue; // 自转移单独处理
                    let r2, p2, score;
                    if (j < validChordNum) {
                        r2 = j % 12;
                        p2 = j / 12 | 0;
                        score = patternDict[ptnKey[p2]].prob;
                    } else {
                        r2 = p2 = -1;
                        score = P_N; // 进入N状态的概率
                    }
                    if (r1 !== -1 && r2 !== -1) {
                        const interval = (r2 - r1 + 12) % 12;
                        // --- 乐理规则增强 ---
                        // 强功能进行：上行纯四度 (+5)
                        if (interval === 5) {
                            score *= 5.0;
                            if (TENSION.includes(p1) && STABLE.includes(p2)) score *= 2.0; // V7 -> I 逻辑
                        }
                        // 下行三度进行：(-3 或 -4)
                        else if (interval === 8 || interval === 9) {
                            score *= 3.0; // I -> vi 或 I -> iii
                        }
                        // 上行二度：(+2) 
                        else if (interval === 2) {
                            score *= 2.5; // IV -> V 逻辑
                        }
                        // 挂留解决：同根音
                        else if (interval === 0 && SUSPENSE.includes(p1) && STABLE.includes(p2)) {
                            score *= 10.0; // sus -> Major/Minor 极高概率
                        }
                        // 减/增和弦倾向解决
                        else if (interval === 1 && ptnKey[p1] === "dim7") { // dim7 -> 半音上行
                            score *= 4.0;
                        }
                        // 惩罚：避免无意义的频繁模式切换（根音不变时）
                        else if (interval === 0 && p1 !== p2) {
                            const n1 = patternDict[ptnKey[p1]].pattern.length;
                            const n2 = patternDict[ptnKey[p2]].pattern.length;
                            if (n2 < n1) score *= 0.9; // 变向更简单的和弦，惩罚极小
                            else score *= 0.1; // 变向更复杂的和弦，保持高惩罚
                        }
                    }
                    row[j] = score;
                    sumScore += score;
                }
                // 归一化并取 Log
                const scale = (1 - P_STAY) / sumScore;
                for (let j = 0; j < chordNum; j++) {
                    row[j] = Math.log(i === j ? P_STAY : row[j] * scale);
                }
            } return pMat;
        })();
        ChordEst.initOctaveW();
    }
    /**
     * Viterbi 单步处理
     * @param {Float32Array} obs 长度为12的观测Chroma向量 (应先归一化)
     */
    step(obs) {
        const n = this.chordDict.length;
        const likelihood = new Float32Array(n);
        const ptrs = new Uint16Array(n);
        // 发射概率
        let p_sum = 0;
        for (let i = 0; i < n; i++) {
            let dot = 0;
            const v = this.chordDict[i].vec;
            for (let k = 0; k < 12; k++) dot += obs[k] * v[k];
            if (dot < 0) dot = 0;
            let p = Math.pow(dot, 5);   // 使用高次幂拉开差距
            p_sum += p;
            likelihood[i] = p == 0 ? -Infinity : Math.log(p);
        }
        if (p_sum < 1e-4) {
            // 如果所有和弦的似然都很小，则认为是无和弦状态
            likelihood.fill(-Infinity);
            likelihood[this.chordDict.length - 1] = 0;
        } else {
            // 否则正常归一化似然
            p_sum = Math.log(p_sum);
            for (let i = 0; i < n; i++) {
                if (likelihood[i] > -Infinity) likelihood[i] -= p_sum;
            }
        }

        if (this.states.length === 0) {
            // 第一帧使用先验
            for (let i = 0; i < n; i++) likelihood[i] += this.logPriorP[i];
        } else {
            const prevScores = this.states[this.states.length - 1].scores;
            for (let j = 0; j < n; j++) {
                let maxS = -Infinity;
                let maxIdx = 0;
                // 遍历上一帧所有状态 i 转移到当前状态 j
                for (let i = 0; i < n; i++) {
                    const s = prevScores[i] + this.logTransP[i][j];
                    if (s > maxS) maxS = s, maxIdx = i;
                }
                likelihood[j] += maxS;
                ptrs[j] = maxIdx;
            }
        }
        this.states.push({ scores: likelihood, ptrs });
    }
    /**
     * 回溯得到最终和弦序列
     * @returns {Array<string>} 和弦名称序列
     */
    decode() {
        if (this.states.length === 0) return [];
        const n = this.chordDict.length;
        const T = this.states.length;
        const result = new Array(T);
        // 找到最后一帧得分最高的
        let lastScores = this.states[T - 1].scores;
        let curr = 0, maxS = -Infinity;
        for (let i = 0; i < n; i++) {
            if (lastScores[i] > maxS) maxS = lastScores[i], curr = i;
        }
        // 回溯
        for (let t = T - 1; t >= 0; t--) {
            result[t] = this.chordDict[curr].name;
            curr = this.states[t].ptrs[curr];
        }
        // 清理状态以便下次识别
        this.states = [];
        return result;
    }

    // 频谱到chroma的权重
    static octaveW;
    static initOctaveW() {
        if (ChordEst.octaveW) return;
        const W = this.octaveW = new Float32Array(84);
        const T = 84;
        // const T = 84 * 6 / 5;
        let w = 2 * Math.PI / T;
        // let b = -Math.PI * 2 / 3;
        let b = -Math.PI;
        for (let i = 0; i < 84; i++) {
            // 往低频靠近
            W[i] = (Math.cos(w * i + b) + 1) / Math.pow(2, i / 24);
        }
        let sum = 0;
        for (let c of W) sum += c;
        sum = 12 / sum;
        for (let i = 0; i < W.length; i++) W[i] *= sum;
    }
    /**
     * 从频谱中得到Chroma能量向量
     * @param {Array<Float32Array>} spect84 多个长84的 幅度
     * @param {Float32Array} buffer 长12
     * @return {Float32Array} 长度为12的Chroma向量
     */
    chroma(spect84, buffer = null) {
        if (buffer == null) buffer = new Float32Array(12);
        else buffer.fill(0);
        const W = ChordEst.octaveW;
        for (const f of spect84) {
            for (let k = 0; k < 84; k++) {
                buffer[k % 12] += f[k] * f[k] * W[k];
            }
        }
        for (let i = 0; i < 12; i++) buffer[i] = buffer[i] / spect84.length;
        return buffer;
    }
}