/**
 * @file ANA.js (auto note alignment)
 * @abstract 融合HMM和DTW的音符自动对齐
 * @description
 * ## 记法
 * 从左到右——时频谱从开始到结尾
 * 从上到下——音符序列从开始到结尾
 * 起点：左上角；终点：右下角
 * 
 * ## 转移规则:
 * 从左到右从上到下计算
 * 仅有当前格为-1时才能计算向下扩散，向下扩散不使用状态转移概率(实际还是用了，提高切换的门槛)
 * 其余都只能向右和右下扩散
 * 计算第t列仅能使用第(t-1)列，需要乘上状态转移概率
 * 
 * P(s_{t}=-1 | s_{t-1}=-1) = 0.32
 * P(s_{t}!=-1 | s_{t-1}=-1) = 0.68
 * 
 * P(s_{t}=-1 | s_{t-1}!=-1) = 0.2
 * P(s_{t}=s_{t-1} | s_{t-1}!=-1) = 0.8
 * 
 * ## 激发概率
 * 取可能遇到的bin的max，以此为边界缩放，并小值补偿（开根号），记为当前bin存在音符的概率
 */

/**
 * HMM 进行自动音符-音频对齐 规则见上
 * @param {Array<number>} noteSeq 音符序列，已经插入了间隔-1
 * @param {Array<Float32Array>} spectrum 时频谱 第一维是时间
 * @param {number} minLen 建议的音符最小长度 可为小数
 * @returns {Array<Array<number>>} 全局最优路径 [[n, s], [n2, s2], ...]
 */
function autoNoteAlign(noteSeq, spectrum, minLen = 2) {
    class AlignInfo {
        constructor(v = -Infinity, k = 0) {
            this.value = v; // 指向上一帧的某个bin
            this.keep = k;  // 音符长度
        }
    };

    /**
     * 找到可能的最大最小值，返回线性归一化函数
     * @param {Set<number>} noteSet 
     * @param {Array<Float32Array>} spectrum 
     * @returns {Function(number)} 归一化函数
     */
    function _getNormalizeFN(noteSet, spectrum) {
        let max = -Infinity;
        let min = Infinity;
        for (const s of spectrum) {
            for (const bin of noteSet) {
                if (s[bin] > max) max = s[bin];
                if (s[bin] < min) min = s[bin];
            }
        }
        const len = max - min;
        return (x) => (x - min) / len;
    }

    const fn = _getNormalizeFN(new Set(noteSeq), spectrum);
    let buffer_curr = Array(noteSeq.length);
    let buffer_prev = Array(noteSeq.length);
    for (let i = 0; i < noteSeq.length; i++) {
        buffer_curr[i] = new AlignInfo();
        buffer_prev[i] = new AlignInfo();
    }
    buffer_prev[0].value = 0;

    const k = 0.52; // 由于大值很少，0很多，因此要提高对小值的敏感度

    const P = Array(spectrum.length);
    for (let frame = 0; frame < spectrum.length; frame++) {
        const from = P[frame] = new Uint16Array(noteSeq.length).fill(-1);
        const frameSpectrum = spectrum[frame];
        // 先向右和右下扩散
        for (let i = 0; i < noteSeq.length; ++i) {
            const root = buffer_prev[i];
            // 由于路径限制，并不是每个位置都能到达，可以跳过
            if (root.value === -Infinity) break;
            if (noteSeq[i] === -1) {
                if (i + 1 < noteSeq.length) {
                    const hasNote = Math.pow(fn(frameSpectrum[noteSeq[i + 1]]), k);
                    // 以下的概率和不为1...然而强制缩放为1效果很差，不如就这样，可解释性还高
                    const keepP = 0.32;
                    // 保持空状态
                    const right = root.value + Math.log(Math.max((1 - hasNote) * keepP, 1e-12));
                    if (buffer_curr[i].value < right) {
                        buffer_curr[i].value = right;
                        from[i] = i;
                        buffer_curr[i].keep = root.keep + 1;
                    }
                    // 切换为音符
                    const rightdown = root.value + Math.log(Math.max(hasNote * (1 - keepP), 1e-12));
                    if (buffer_curr[i + 1].value < rightdown) {
                        buffer_curr[i + 1].value = rightdown;
                        from[i + 1] = i;
                        buffer_curr[i + 1].keep = 0;
                    }
                } else {    // 没有下一个了 保持较小速率降低
                    const p = root.value - 1;
                    if (buffer_curr[i].value < p) {
                        buffer_curr[i].value = p;
                        from[i] = i;
                        buffer_curr[i].keep = root.keep + 1;
                    }
                }
            } else {    // 是音符
                const hasNote = Math.pow(fn(frameSpectrum[noteSeq[i]]), k);
                let keepP = 0.8;
                if (root.keep < minLen) {
                    // 初始概率必须大 不然高时间分辨率频谱下容易出现很碎的音
                    keepP = 0.999 - 0.09 * (root.keep / minLen);
                }
                // 保持音符
                const right = root.value + Math.log(Math.max(hasNote * keepP, 1e-12));
                if (buffer_curr[i].value < right) {
                    buffer_curr[i].value = right;
                    from[i] = i;
                    buffer_curr[i].keep = root.keep + 1;
                }
                // 暂停
                const rightdown = root.value + Math.log(Math.max((1 - hasNote) * (1 - keepP), 1e-12));
                if (buffer_curr[i + 1].value < rightdown) {
                    buffer_curr[i + 1].value = rightdown;
                    from[i + 1] = i;
                    buffer_curr[i + 1].keep = 0;
                }
            }
        }
        // 再处理纵向扩散 第一位永远是-1可以跳过
        for (let i = 1; i < noteSeq.length; ++i) {
            if (buffer_curr[i - 1].value === -Infinity) break;
            if (noteSeq[i - 1] === -1) {
                const hasNote = Math.pow(fn(frameSpectrum[noteSeq[i]]), k);
                const down = buffer_curr[i - 1].value + Math.log(Math.max(hasNote * 0.8, 1e-12));
                if (buffer_curr[i].value < down) {
                    buffer_curr[i].value = down;
                    from[i] = from[i - 1];
                    buffer_curr[i].keep = 0;
                }
            }
        }
        // 交换位置并复原
        [buffer_curr, buffer_prev] = [buffer_prev, buffer_curr];
        for (const i of buffer_curr) {
            i.keep = 0;
            i.value = -Infinity;
        }
    }
    // 寻路
    const path = [];
    let noteidx = noteSeq.length - 1;
    for (let frame = P.length - 1; frame >= 0; frame--) {
        path.push([noteidx, frame]);
        noteidx = P[frame][noteidx];
    }
    path.reverse();
    return path;
}