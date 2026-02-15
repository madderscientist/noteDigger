///<reference path="fft_real.js" />
/**
 * @file bpmEst.js
 * @abstract BPM估计相关算法
 * @description 算法说明: https://zhuanlan.zhihu.com/p/1995849093491222501
 */

class SIGNAL {
    /**
     * 峰值检测
     * @param {Float32Array} arr 输入数据
     * @param {number} prominence 显著性阈值
     * @returns {Array} 找到的峰值索引数组 从小到大
     */
    static findPeaks(arr, prominence = 0) {
        const len = arr.length;
        const outBuffer = [];
        for (let i = 1; i < len - 1; i++) {
            const current = arr[i];
            if (current <= arr[i - 1] || current <= arr[i + 1]) continue;
            // 查找左侧基准
            let l = i - 1;
            while (l > 0 && arr[l - 1] <= arr[l]) l--;
            // 查找右侧基准
            let r = i + 1;
            while (r < len - 1 && arr[r + 1] <= arr[r]) r++;
            // 计算显著性
            const leftMin = arr[l];
            const rightMin = arr[r];
            const maxBase = leftMin > rightMin ? leftMin : rightMin;
            if (current - maxBase >= prominence) outBuffer.push(i);
        } return outBuffer;
    }

    /**
     * 抛物线插值，返回相对于x2的偏移量
     * @param {number} y1 
     * @param {number} y2 极值点
     * @param {number} y3 
     * @returns {Array<number>} [峰值相对于x2的偏移量, 插值后的y值]
     */
    static parabolicInterpolation(y1, y2, y3) {
        const a = y1 + y3 - 2 * y2;
        const b = y1 - y3;
        if (a === 0) return [0, y2];
        const dx = b / (2 * a);
        const y = y2 - b * dx * 0.25;
        return [dx, y];
    }

    /**
     * IIR滤波器实现（直接型II结构，支持任意阶数）
     * @param {Float32Array} arr 输入信号
     * @param {Array<number>} b 分子系数（b[0], b[1], ..., b[M]）
     * @param {Array<number>} a 分母系数（a[0], a[1], ..., a[N]），a[0]通常为1，会自动归一化
     * @param {boolean} inplace 是否就地滤波（修改输入数组）
     * @param {boolean} reverse 是否反向滤波（用于filtfilt）
     * @returns {Float32Array} 滤波后信号
     * @example 二阶高通滤波器
     * 差分方程：
     *   y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
     * 对应传参：
     *   b = [b0, b1, b2]
     *   a = [1, a1, a2]
     */
    static filter(arr, b, a, inplace = false, reverse = false) {
        const order = Math.max(b.length, a.length);
        const result = inplace ? arr : (new Float32Array(arr.length));
        const xHist = new Float32Array(order);
        const yHist = new Float32Array(order);
        let xPtr = 0, yPtr = 0;
        const processSample = (n) => {
            xHist[xPtr] = arr[n];
            let y = 0;
            for (let i = 0; i < b.length; i++)
                y += b[i] * xHist[(xPtr - i + order) % order];
            for (let i = 1; i < a.length; i++)
                y -= a[i] * yHist[(yPtr - i + order) % order];
            y /= a[0];
            yHist[yPtr] = y;
            result[n] = y;
            // 不用取余 加速
            if (++xPtr >= order) xPtr = 0;
            if (++yPtr >= order) yPtr = 0;
        }
        if (reverse) {
            for (let n = arr.length - 1; n >= 0; n--) processSample(n);
        } else {
            for (let n = 0; n < arr.length; n++) processSample(n);
        } return result;
    }

    /**
     * 自相关函数 点积，进行了幅度补偿和归一化
     * 通常用于较长序列
     * @param {Float32Array} arr 输入一维时序信号
     * @param {number} points 偏移点数
     * @param {Float32Array} result 可选的输出数组
     * @returns {Float32Array} 有效长度为 points
     */
    static autoCorr(arr, points, result = undefined) {
        const L = arr.length;
        if (result === undefined || result.length < points) result = new Float32Array(points);
        // 先计算直流量用于幅度补偿
        let mean = 0;
        for (let i = 0; i < L; i++) mean += arr[i] * arr[i];
        mean = L / mean;
        result[0] = 1;
        // 计算各个tau的自相关值
        for (let tau = 1; tau <= points; tau++) {
            let ac = 0;
            for (let n = L - tau - 1; n >= 0; n--)
                ac += arr[n] * arr[n + tau];
            result[tau] = ac * mean / (L - tau);
        } return result;
    }

    /**
     * 高效的分帧自相关
     * @param {Float32Array} arr onset envelop
     * @param {number} points 进行多少点的自相关
     * @param {number} hopInWin 窗长内有几个hop
     * @param {number} hop 每次移动多少
     * @returns {Array<Float32Array>} 自相关帧数组
     */
    static autoCorrSeg(arr, points, hopInWin, hop = 1) {
        const len = arr.length;
        hopInWin = Math.max(1, hopInWin | 0);

        const numFrames = Math.floor((len - points) / hop) - hopInWin + 1;
        if (numFrames < 1) throw new Error("Input array too short");

        const frames = Array(numFrames);
        for (let i = 0; i < numFrames; i++) {
            frames[i] = new Float32Array(points);
        }

        // 预分配一个通用的 bins 数组，避免在 tau 循环中重复创建
        const maxBinCount = Math.ceil(len / hop);
        const bins = new Float32Array(maxBinCount);

        for (let tau = 0; tau < points; tau++) {
            // 预计算当前 tau 下的所有 bins
            const currentBinCount = Math.floor((len - tau) / hop);
            for (let b = 0, start = 0; b < currentBinCount; b++) {
                let binSum = 0;
                // 内部小循环计算一个 hop 长度的乘积和
                for (let n = 0; n < hop; n++, start++) {
                    binSum += arr[start] * arr[start + tau];
                } bins[b] = binSum;
            }

            // 初始窗口的和 (第一个 frame)
            let running = 0;
            for (let f = 0; f < hopInWin; f++) {
                running += bins[f];
            } frames[0][tau] = running;

            // 滑动更新后续 frame
            for (let frameIdx = 1; frameIdx < numFrames; frameIdx++) {
                running += bins[frameIdx + hopInWin - 1] - bins[frameIdx - 1];
                frames[frameIdx][tau] = running;
            }
        }

        // 归一化
        for (let f = 0; f < numFrames; f++) {
            const frame = frames[f];
            const energy = frame[0];
            if (energy < 1e-10) continue;
            const invEnergy = 1 / energy;
            frame[0] = 1;
            for (let tau = 1; tau < points; tau++) {
                frame[tau] *= invEnergy;
            }
        }

        return frames;
    }

    /**
     * 根据分析窗和hop长度生成配套的ISTFT合成窗
     * @param {Float32Array} analysisWindow 分析阶段使用的窗
     * @param {number} hop 跳跃长度
     * @returns {Float32Array} 合成窗
     */
    static createSynthesisWindow(analysisWindow, hop) {
        const n = analysisWindow.length;
        const res = new Float32Array(n);
        let h = 0;
        for (let i = 0; i < n; i++) {
            const val = analysisWindow[i];
            res[h] += val * val;
            if (++h === hop) h = 0;
        }

        // 将能量和转换为倒数 减少除法次数
        for (let i = 0; i < hop; i++) {
            const s = res[i];
            res[i] = s > 1e-10 ? 1.0 / s : 0;
        }

        // 生成最终合成窗 必须从后往前遍历 (n-1 到 0)
        h = (n - 1) % hop;
        for (let i = n - 1; i >= 0; i--) {
            res[i] = analysisWindow[i] * res[h];
            if (--h < 0) h = hop - 1;
        } return res;
    }
}

class Beat {
    /**
     * 根据采样率得到适合的FFT长度
     * @param {number} fs onset的采样率
     * @param {number} sec 音频长度（秒）
     * @returns {number} FFT的大小
     */
    static fs2FFTN(fs, sec = 50) {
        let n = fs * sec;   // 用50秒的音频，分辨率大概有1.2BPM
        return 1 << Math.round(Math.log2(n));
    }

    /**
     * 压缩异常大的值 原位操作
     * @param {Float32Array} onsetEnv
     * @param {number} percent 分位数
     * @param {number} margin_ratio 允许超出的最大比例 大于1
     * @returns {Float32Array} onsetEnv 返回同一个引用
     */
    static compressOutliers(onsetEnv, percent = 0.99, margin_ratio = 1.3) {
        // 理论上可以用堆排序只找后1%，但是sort底层是C++实现的，性能已经足够好了
        const sorted = Array.from(onsetEnv).sort((a, b) => a - b);
        const margin = sorted[(sorted.length * percent) | 0];   // floor会使得索引一定存在
        const marginMax = margin * margin_ratio;
        const actualMax = sorted[sorted.length - 1];
        if (actualMax <= marginMax) return onsetEnv;
        // 用三次函数压缩
        const x0 = actualMax - margin;
        const y0 = marginMax - margin;
        const a = (x0 - 2 * y0) / (x0 * x0 * x0);
        const b = (3 * y0 - 2 * x0) / (x0 * x0);
        const trans = (x) => x * (a * x * x + b * x + 1);
        for (let i = 0; i < onsetEnv.length; i++) {
            if (onsetEnv[i] > margin) onsetEnv[i] = trans(onsetEnv[i] - margin) + margin;
        } return onsetEnv;
    }

    /**
     * 高通滤波去除趋势 原位操作
     * @param {Float32Array} onsetEnv
     * @returns {Float32Array} 去趋势后的onsetEnv 同一个引用
     */
    static detrend(onsetEnv) {
        // 对于20Hz采样的频谱，用0.96对低频的压制较好 0.9低频压制太多 0.99低频压制太少
        const b = [1, -1];
        const a = [1, -0.96];
        // filtfilt
        SIGNAL.filter(onsetEnv, b, a, true, false);
        SIGNAL.filter(onsetEnv, b, a, true, true);
        return onsetEnv;
    }

    /**
     * 除以标准差并保持非负 原位操作
     * @param {Float32Array} onsetEnv 
     * @returns {Float32Array} onsetEnv 同一个引用
     */
    static onsetNorm(onsetEnv) {
        let std = 0;
        let minVal = Infinity;
        let mean = 0;
        for (const v of onsetEnv) {
            mean += v;
            std += v * v;
            if (v < minVal) minVal = v;
        }
        mean /= onsetEnv.length;
        std = Math.sqrt(std / onsetEnv.length - mean * mean);
        for (let i = 0; i < onsetEnv.length; i++) {
            onsetEnv[i] = (onsetEnv[i] - minVal) / std;
        } return onsetEnv;
    }

    /**
     * 对数谱差分法提取 onset envelope
     * 会进行抑制峰值、去趋势、std归一化、非负化
     * @param {Array<Float32Array>} spectrogram 幅度谱
     * @param {number} a 平滑系数 0~1 越大越不平滑
     * @returns {Float32Array} onset envelope
     */
    static extractOnset(spectrogram, a = 0.8) {
        const ra = 1 - a;
        const onsetEnv = new Float32Array(spectrogram.length);
        const prevFrame = new Float32Array(spectrogram[0].length);
        prevFrame.fill(Math.log(1e-2)); // 防止一开始就有大变化
        for (let i = 0; i < spectrogram.length; i++) {
            const frame = spectrogram[i];
            let diff = 0;
            for (let j = 0; j < frame.length; j++) {
                const logedValue = Math.log(frame[j] + 1e-6);
                const delta = logedValue - prevFrame[j];
                if (delta > 0) diff += delta;
                // 滑动更鲁棒
                prevFrame[j] = prevFrame[j] * ra + logedValue * a;
            } onsetEnv[i] = diff;
        }
        // 抑制峰值
        Beat.compressOutliers(onsetEnv, 0.99, 1.3);
        // 去趋势
        Beat.detrend(onsetEnv);
        // 归一化并非负化
        return Beat.onsetNorm(onsetEnv);
    }

    /**
     * 浮点数最大公因数
     * @param {Float32Array} idx 峰值序号数组
     * @param {Uint8Array} N 可选的倍数数组
     * @returns {number} 最大公因数
     */
    static floatGCD(idx, N) {
        // 用最小间隔估计一个初始值 这里假设一次差分就能获取
        let minInterval = idx[0];
        for (let i = 1; i < idx.length; i++) {
            let inter = idx[i] - idx[i - 1];
            if (inter < minInterval) minInterval = inter;
        }
        // 计算各个idx对应的倍数 并动态修正 minInterval
        if (N === undefined) N = new Uint8Array(idx.length);
        for (let i = 0; i < idx.length; i++) {
            const n = Math.round(idx[i] / minInterval);
            N[i] = n;
            // 修正 minInterval 因为距离越远误差越小
            minInterval = (minInterval + idx[i] / n) * 0.5;
        }
        // MSE求最佳 minInterval
        let a = 0, b = 0;
        for (let i = 0; i < idx.length; i++) {
            a += N[i] * N[i];
            b += N[i] * idx[i];
        }
        return b / a;
    }

    /**
     * 对自相关结果进行BPM估计
     * 从自相关结果中找到BPM峰值
     * @param {Float32Array} corr 自相关结果
     * @param {number} sr 采样率
     * @param {number} BPMstd BPM的标准差 用于高斯加权
     * @param {number} BPMu 期望的BPM值 用于高斯加权
     * @returns {number} 估计的BPM值 如果无法估计则返回NaN
     */
    static corrBPM(corr, sr, BPMstd = 1, BPMu = 110) {
        if (corr.length < 3) throw new Error("Correlation array too short");
        const maxInterval = Math.ceil(60 * sr / 35) + 1; // 35 BPM对应的最大间隔 更低的不管
        if (corr.length > maxInterval) corr = corr.subarray(0, maxInterval);
        // 峰值插值
        let peakIdx = SIGNAL.findPeaks(corr, 0.02);
        if (peakIdx.length === 0) return NaN;   // 置信度太小了，无法估计
        const peak = new Float32Array(peakIdx.length);
        for (let i = 0; i < peakIdx.length; i++) {
            const idx = peakIdx[i];
            const [dx, y] = SIGNAL.parabolicInterpolation(
                corr[idx - 1],
                corr[idx],
                corr[idx + 1]
            );
            peakIdx[i] = idx + dx;
            peak[i] = y;
        }
        // 得到候选BPM
        const N = new Uint8Array(peakIdx.length);
        const nBPM = 60 * sr / Beat.floatGCD(peakIdx, N); // 一定是整数倍
        // 选择最显著的BPM 用高斯权重
        let bestBPM = nBPM, maxVal = -1;
        BPMu = Math.log2(BPMu);
        for (let i = 0; i < peakIdx.length; i++) {
            const bpm = nBPM / N[i];  // 候选BPM
            const k = (Math.log2(bpm) - BPMu) / BPMstd;
            const q = peak[i] * Math.exp(-0.5 * k * k);
            if (q > maxVal) {
                maxVal = q;
                bestBPM = bpm;
            }
        } return bestBPM;
    }

    /**
     * 估计每帧的BPM值
     * @param {Float32Array} onsetEnv extractOnset的结果
     * @param {number} onset_sr 采样率
     * @param {number} minBPM 允许的最小BPM值 用于得到autoCorrSeg的points参数
     * @param {number} winSec 窗口长度（秒）实际使用时会向上调整为hop的整数倍
     * @param {number} hopSec hop长度（秒）
     * @param {number} centerBPM corrBPM的BPMu参数
     * @param {number} BPMstd corrBPM的BPMstd参数
     * @returns {Float32Array} 每帧的BPM估计值
     */
    static tempo(onsetEnv, onset_sr, minBPM, winSec, hopSec = 1, centerBPM = 110, BPMstd = 0.5) {
        // 确保winLen是hop的整数倍
        const hop = Math.max(1, Math.round(onset_sr * hopSec));
        const hopInWin = Math.ceil(winSec / hopSec);
        const winLen = hopInWin * hop;

        const maxInterval = Math.ceil(onset_sr * 60 / minBPM) + 1;
        const corrFrames = SIGNAL.autoCorrSeg(onsetEnv, maxInterval, hopInWin, hop);

        let f = winLen >> 1;
        const BPMt = new Float32Array(onsetEnv.length);
        let validBPM = centerBPM;   // 如果都是NaN只能相信给的值
        let NanIdx = [];
        for (let i = 0; i < corrFrames.length; f += hop, i++) {
            const bpm = Beat.corrBPM(corrFrames[i], onset_sr, BPMstd, centerBPM);
            if (isNaN(bpm)) {
                NanIdx.push(f);
                continue;
            }
            validBPM = BPMt[f] = bpm;
            centerBPM = centerBPM * 0.8 + BPMt[f] * 0.2;    // 动态更新中心BPM
        }
        // 处理可能的NaN
        for (let a = NanIdx.length - 1; a >= 0; a--)
            BPMt[NanIdx[a]] = BPMt[NanIdx[a + 1]] || validBPM;
        const endAt = f;
        // 其余位置证据不足，直接复制邻近值
        for (f += 1 - hop; f < onsetEnv.length; f++) BPMt[f] = BPMt[f - 1];
        for (f = winLen >> 1; f > 0; f--) BPMt[f - 1] = BPMt[f];
        // 中间用线性插值
        if (hop === 1) return BPMt;
        f = winLen >> 1;
        let lastVal = BPMt[f];
        let nextIdx = f + hop;
        while (nextIdx < endAt) {
            const nextVal = BPMt[nextIdx];
            const step = (nextVal - lastVal) / hop;
            for (let i = 1; i < hop; i++) BPMt[f + i] = lastVal + step * i;
            f = nextIdx;
            lastVal = nextVal;
            nextIdx += hop;
        } return BPMt;
    }

    /**
     * Ellis节拍追踪算法实现
     * @param {Float32Array} onsetEnv extractOnset的结果
     * @param {number} onset_sr 采样率
     * @param {number} tightness 动态规划的超参数 越大表示越尊重给出的节奏估计
     * @param {number|Float32Array} bpm 单值:负数表示偏好,正值表示估计; Float32Array:每帧BPM估计
     * @param {Array|null} rangeBPM [MinBPM, MaxBPM] 搜索范围 传入null表示范围无限制
     * 以下参数仅在bpm为负数时有效
     * @param {number} winSec 进行自相关的窗口长度（秒）
     * @param {number} hopSec 自相关的hop长度（秒）
     * @returns {Array} 识别到的节拍索引数组
     */
    static EllisBeatTrack(onsetEnv, onset_sr, tightness = 100, bpm = -110, rangeBPM = [40, 200], winSec = 16, hopSec = 1) {
        const sr60 = onset_sr * 60;
        const frameRange = (rangeBPM === null) ? [1, Infinity] : [sr60 / rangeBPM[1], sr60 / rangeBPM[0]];
        if (typeof bpm === "number") {
            if (bpm > 0) return Beat.beatTrackDp(
                // 平滑以鲁棒
                Beat.beatLocalScore(onsetEnv, bpm),
                sr60 / bpm,
                frameRange,
                tightness
            );
            // bpm < 0 偏好模式
            const BPMt = Beat.tempo(onsetEnv, onset_sr, rangeBPM[0], winSec, hopSec, -bpm);
            for (let i = 0; i < BPMt.length; i++) BPMt[i] = sr60 / BPMt[i]; // 转换为 帧/拍
            return Beat.beatTrackDp(
                Beat.beatLocalScore(onsetEnv, BPMt),
                BPMt,
                frameRange,
                tightness
            );
        }
        if (bpm.length !== onsetEnv.length) throw new Error("bpm length must match onsetEnv length");
        const fpb = new Float32Array(bpm.length);
        for (let i = 0; i < bpm.length; i++) fpb[i] = sr60 / bpm[i];
        return Beat.beatTrackDp(
            Beat.beatLocalScore(onsetEnv, fpb),
            fpb,
            frameRange,
            tightness
        );
    }

    /**
     * 对onset进行平滑，得到局部节拍得分
     * 直接抄袭的librosa的实现
     * @param {Float32Array} onsetEnvelope
     * @param {number|number[]|Float32Array} framesPerBeat 每拍帧数，可以是单值或与onsetEnvelope等长的数组
     * @returns {Float32Array} 平滑后的局部节拍得分
     */
    static beatLocalScore(onsetEnvelope, framesPerBeat) {
        const N = onsetEnvelope.length;
        const localscore = new Float32Array(N);
        if (typeof framesPerBeat === "number") framesPerBeat = [framesPerBeat];

        let window = null;
        const getWindow = (fpb) => {
            const halfK = fpb | 0;
            const K = (halfK << 1) | 1;
            if (window === null || window.length < K)
                window = new Float32Array(K);
            const scale = 24 / fpb; // 越大意味着越窄
            // librosa没有对窗进行归一化 会导致对低节拍的偏好
            let sum = 0;
            for (let i = 0, j = -halfK; i < K; ++i, ++j) {
                const x = j * scale;
                sum += window[i] = Math.exp(-0.5 * x * x);
            }
            for (let i = 0; i < K; i++) window[i] /= sum;
            return { K, halfK };
        };

        if (framesPerBeat.length === 1) {
            // --- 静态节奏模式 ---
            const { K, halfK } = getWindow(framesPerBeat[0]);
            for (let i = 0; i < N; i++) {
                let sum = 0;
                const kMax = Math.min(i + halfK, K);
                for (let k = Math.max(0, i + halfK - N + 1); k < kMax; k++) {
                    sum += window[k] * onsetEnvelope[i + halfK - k];
                } localscore[i] = sum;
            }
        } else if (framesPerBeat.length === N) {
            // --- 动态节奏模式 ---
            let lastFpb = -1;
            let K, halfK;
            for (let i = 0; i < N; i++) {
                const currentFpb = Math.round(framesPerBeat[i]);
                // 只有当 fpb 变化时才更新窗口
                if (currentFpb !== lastFpb) {
                    const res = getWindow(currentFpb);
                    K = res.K;
                    halfK = res.halfK;
                    lastFpb = currentFpb;
                }
                let sum = 0;
                const kMax = Math.min(i + halfK, K);
                for (let k = Math.max(0, i + halfK - N + 1); k < kMax; k++) {
                    sum += window[k] * onsetEnvelope[i + halfK - k];
                } localscore[i] = sum;
            }
        } else throw new Error('framesPerBeat 长度必须为 1 或与 onsetEnvelope 等长');
        return localscore;
    }

    /**
     * 节拍追踪动态规划核心逻辑 (Ellis 算法)
     * @param {Float32Array} localscore 平滑后的起始强度 (beatLocalScore 的输出)
     * @param {Float32Array|number[]|number} framesPerBeat 每拍帧数 (1个或N个) 可以为浮点
     * @param {number[]} frameRange 帧范围 [minFrame, maxFrame] 都包含
     * @param {number} tightness 转移代价权重
     * @returns {Array} 识别到的节拍索引数组
     */
    static beatTrackDp(localscore, framesPerBeat, frameRange = [1, Infinity], tightness = 110) {
        if (typeof framesPerBeat === "number") framesPerBeat = [framesPerBeat];
        const isDynamicTempo = framesPerBeat.length > 1;
        const minFrame = Math.max(1, frameRange[0]) | 0;
        const maxFrame = Math.max(minFrame + 1, Math.ceil(frameRange[1]));

        const N = localscore.length;
        const dp = new Float32Array(N);
        const backlink = new Int32Array(N);

        // 计算第一个节拍必须超过的阈值
        let scoreThresh = 0;
        for (let i = 0; i < N; i++) {
            if (localscore[i] > scoreThresh) scoreThresh = localscore[i];
        } scoreThresh *= 0.01;

        let firstBeat = true;

        // 预计算 Log 表以提升性能 范围最大为 frameRange
        const r = Math.min(maxFrame - minFrame, N) + 1;
        const logTable = new Float32Array(r);
        for (let j = 0; j < r; j++) logTable[j] = Math.log(j + minFrame);

        for (let t = 0; t < N; t++) {
            // 获取当前的期望每拍帧数 (fpb)
            const fpb = isDynamicTempo ? framesPerBeat[t] : framesPerBeat[0];
            const targetInter = Math.log(fpb);

            // librosa的搜索区间：[i - 2*fpb, i - fpb/2]
            // 同时还受限于 frameRange
            const searchStart = t - Math.round(Math.max(minFrame, fpb * .5));
            let searchEnd = t - Math.round(Math.min(maxFrame, fpb * 2));
            if (searchEnd < 0) searchEnd = 0;

            // 在搜索范围内寻找最优的前驱节点
            let beatT = -1, maxS = -Infinity;
            for (let tau = searchStart; tau >= searchEnd; tau--) {
                const diff = logTable[t - tau - minFrame] - targetInter;
                const s = dp[tau] - tightness * diff * diff;
                if (s > maxS) {
                    maxS = s;
                    beatT = tau;
                }
            }

            // 累加得分到 dp 数组
            const scoreI = localscore[t];
            dp[t] = (beatT >= 0) ? (scoreI + maxS) : scoreI;
            // if (isNaN(dp[t])) console.warn(`NaN detected at dp[${t}]`);
            // 起始点判定 在找到第一个超过阈值的有效起始点之前，不建立回溯链接
            if (firstBeat && scoreI < scoreThresh) {
                backlink[t] = -1;
            } else {
                backlink[t] = beatT;
                firstBeat = false;
            }
        }
        // 回溯
        let tail = Beat.getLastBeat(dp);
        const beatIndices = [];
        while (tail >= 0) {
            beatIndices.push(tail);
            tail = backlink[tail];
        }
        return beatIndices.reverse();
    }

    /**
     * 识别最后一次检测到的 beat 位置 (Ellis 算法)
     * @param {Float32Array|Array} cumscore 累积得分数组
     * @returns {number} 最后一次 beat 的索引
     */
    static getLastBeat(cumscore) {
        const n = cumscore.length;
        if (n === 0) return 0;

        // 1. 提取局部极大值 (Peaks) 预分配内存
        const preLen = (n >> 1) + 1;
        const peaks = new Float32Array(preLen);
        const peakIndices = new Int32Array(preLen);
        let peakCount = 0;
        for (let i = 1; i < n - 1; i++) {
            const val = cumscore[i];
            if (val > cumscore[i - 1] && val >= cumscore[i + 1]) {
                peaks[peakCount] = val;
                peakIndices[peakCount] = i;
                peakCount++;
            }
        }
        // 单独判断最后一个; librosa 不考虑第一个点
        if (cumscore[n - 1] > cumscore[n - 2]) {
            peaks[peakCount] = cumscore[n - 1];
            peakIndices[peakCount] = n - 1;
            peakCount++;
        }
        if (peakCount === 0) return n - 1;

        // 2. 中位数计算函数
        function getMedianOfPeaks(arr, len) {
            const swap = (i, j) => {
                const tmp = arr[i];
                arr[i] = arr[j];
                arr[j] = tmp;
            };
            function partition(left, right, pivotIdx) {
                const pivotValue = arr[pivotIdx];
                swap(pivotIdx, right);
                let storeIdx = left;
                for (let i = left; i < right; i++) {
                    if (arr[i] < pivotValue) {
                        swap(i, storeIdx);
                        storeIdx++;
                    }
                }
                swap(storeIdx, right);
                return storeIdx;
            }
            function quickSelect(k) {
                let left = 0;
                let right = len - 1;
                while (left <= right) {
                    if (left === right) return arr[left];
                    let pivotIdx = (left + right) >>> 1;
                    pivotIdx = partition(left, right, pivotIdx);
                    if (k === pivotIdx) return arr[k];
                    if (k < pivotIdx) right = pivotIdx - 1;
                    else left = pivotIdx + 1;
                }
            }
            const mid = len >> 1;
            if (len % 2 !== 0) {
                return quickSelect(mid);
            } else {
                // 此时数组已被部分排序，第二次 quickSelect 极快
                const v1 = quickSelect(mid);
                const v2 = quickSelect(mid - 1);
                return (v1 + v2) / 2;
            }
        }

        const median = getMedianOfPeaks(peaks, peakCount);
        const threshold = 0.5 * median;

        // 3. 反向搜索确定最后一个超过阈值的峰值位置
        for (let j = peakCount - 1; j >= 0; j--) {
            const originalIdx = peakIndices[j];
            if (cumscore[originalIdx] >= threshold) {
                return originalIdx;
            }
        } return peakIndices[0];
    }

    /**
     * Predominant local pulse estimation
     * 理解为时变滤波
     * @param {Float32Array} onsetEnv 
     * @param {number} onset_sr 
     * @param {number[]} rangeBPM [MinBPM, MaxBPM]
     * @param {number} winLen STFT窗长
     * @param {number} hopLen STFT hop
     * @param {(number)=>(number)=>number} prior 传入时间点，返回一个函数f，f输入BPM，输出权重
     * @returns {Float32Array} 滤波后的脉冲序列
     */
    static PLP(onsetEnv, onset_sr, rangeBPM = [40, 200], winLen, hopLen, prior) {
        const fft = new realFFT(winLen, 'hanning');
        if (typeof hopLen !== "number") hopLen = fft.N; // 一半的窗长
        if (hopLen <= 0 || hopLen > fft.N << 1) throw new Error("Invalid hop length");
        const win = SIGNAL.createSynthesisWindow(fft.window, hopLen);

        const n_bpm = fft.N / (onset_sr * 30);    // 每BPM对应的频率点数 fft.N只有一半故为30
        const bpm_n = 1 / n_bpm;
        const fMin = Math.min(fft.N, rangeBPM[0] * n_bpm);
        const fMax = Math.max(0, rangeBPM[1] * n_bpm);
        const validPrior = typeof prior === "function";

        const pulse = new Float32Array(onsetEnv.length);    // 最终脉冲序列
        for (let t = fft.N >> 1; t < onsetEnv.length; t += hopLen) {
            let offset = t - fft.N;
            const [real, imag] = fft.fft(onsetEnv, offset);
            // 加窗
            let i = 0;
            for (; i < fMin; i++) real[i] = imag[i] = 0;
            if (validPrior) {
                const p = prior(t);
                let maxMag = -1;
                let maxAt = fMin;
                for (let j = i; j < fMax; j++) {
                    const scale = p(j * bpm_n);
                    real[j] *= scale;
                    imag[j] *= scale;
                    const mag = Math.hypot(real[j], imag[j]);
                    if (mag > maxMag) {
                        maxMag = mag;
                        maxAt = j;
                    }
                }
                // 只保留关键频率
                // for (; i < maxAt; i++) real[i] = imag[i] = 0;
                // librosa 有归一化，但我认为不能有
                // real[maxAt] /= maxMag;
                // imag[maxAt] /= maxMag;
                // for (i = maxAt + 1; i < fMax; i++) real[i] = imag[i] = 0;
            }
            for (i = fft.N - 1; i > fMax; i--) real[i] = imag[i] = 0;
            // 还原
            const time = fft.ifft(real, imag);
            i = 0;
            while (offset < 0) i++, offset++;
            for (; i < fft.N && offset < onsetEnv.length; i++, offset++) {
                pulse[offset] += time[i] * win[i];
            }
        }
        // 仅保留正值 并归一化
        let std = 0, mean = 0, min = Infinity;
        for (let i = 0; i < pulse.length; i++) {
            // const e = pulse[i] = Math.exp(pulse[i] - 1);
            const e = pulse[i] = (pulse[i] > 0) ? pulse[i] : 0;
            mean += e;
            std += e * e;
            if (e < min) min = e;
        }
        mean /= pulse.length;
        std = Math.sqrt(std / pulse.length - mean * mean);
        for (let i = 0; i < pulse.length; i++) pulse[i] = (pulse[i] - min) / std;
        return pulse;
    }

    /**
     * PLP的高斯先验函数生成器
     * @param {Float32Array} BPMt 每帧BPM估计
     * @param {number} std 标准差 0.2刚好在倍数处切掉 0.3适合没有任何先验时使用 搭配BPMt=[]
     * @returns {(number)=>(number)=>number}
     */
    static PLPprior(BPMt = [], std = 0.2) {
        const stdInv = 1 / std;
        return (t) => {
            const logbpm = Math.log2(BPMt[t] || 110);
            return (bpm) => {
                const k = (Math.log2(bpm) - logbpm) * stdInv;
                return Math.exp(-0.5 * k * k);
            }
        };
    }

    /**
     * 获取每个节拍位置的最大onset强度
     * @param {Float32Array} onsetEnv
     * @param {number[]} beatIndices 节拍位置索引
     * @param {number} winLen 搜索范围
     * @returns {Float32Array} beat的onset强度
     */
    static beatStrength(onsetEnv, beatIndices, winLen = 5) {
        const halfWin = winLen >> 1;
        const eng = new Float32Array(beatIndices.length);
        for (let i = 0; i < beatIndices.length; i++) {
            const idx = beatIndices[i];
            let m = -1;
            const end = Math.min(onsetEnv.length - 1, idx + halfWin);
            for (let j = Math.max(0, idx - halfWin); j <= end; j++) {
                if (onsetEnv[j] > m) m = onsetEnv[j];
            } eng[i] = m;
        } return eng;
    }

    /**
     * 假设全局节奏型不变 根据节拍强度推断节奏型
     * @param {Float32Array} beatStrength 
     * @param {number[]} patterns 
     * @returns {[0]:number, [1]:number} 节奏型(小节拍数), 第一个重拍的位置
     */
    static rhythmicPattern(beatStrength, patterns = [2, 3, 4]) {
        const pateng = (size) => {
            const eng = new Float32Array(size);
            const cnt = new Uint16Array(size);
            for (let i = 0; i <= beatStrength.length; i++) {
                const k = i % size;
                eng[k] += beatStrength[i];
                cnt[k]++;
            }
            for (let i = 0; i < size; i++) {
                if (cnt[i] === 0) throw new Error("No beats found for pattern analysis");
                eng[i] /= cnt[i];
            } return eng;
        }
        let maxPattern = 4, maxDiff = -Infinity, maxAt = 0;
        for (const p of patterns) {
            const eng = pateng(p);
            // 找到最大和最小值，最大值要记录位置
            let maxVal = -Infinity, minVal = Infinity, maxIdx = 0;
            for (let i = 0; i < p; i++) {
                const v = eng[i];
                if (v > maxVal) {
                    maxVal = v;
                    maxIdx = i;
                }
                if (v < minVal) minVal = v;
            }
            const diff = maxVal - minVal;
            if (diff > maxDiff) {
                maxDiff = diff;
                maxPattern = p;
                maxAt = maxIdx;
            }
        } return [maxPattern, maxAt];
    }

    /**
     * 根据节拍强度和节拍位置，推断节奏型
     * @param {Float32Array} beatStrength onset envelope at beat positions
     * @param {number[]} meters 支持的小节拍数
     * @returns {[0]:number[], [1]:number[]} 检测到的下拍索引数组，节奏型对应的小节拍数数组
     */
    static detectDownbeats(beatStrength, meters = [2, 3, 4]) {
        const numBeats = beatStrength.length;
        if (numBeats === 0) return [[], []];

        Beat.onsetNorm(beatStrength);

        let states = [];    // 状态=(节奏型, 相位)
        meters.forEach(m => {
            // m: 节奏型 p: 小节内相位(0为重拍) id: 状态唯一标识
            for (let p = 0; p < m; p++) states.push({ m, p, id: `${m}-${p}` });
        });

        // dp 存储: s(加权重拍和), c(加权重拍数), su(加权弱拍和), cu(加权弱拍数), a(累积评分)
        let dp = Array.from({ length: numBeats }, () => ({}));

        // --- 动态参数 ---
        const ALPHA = 0.97;             // 遗忘因子：越小局部性越强 理论最大值为 1 / (1-ALPHA)
        const UPBEAT_W = 0.2;          // 弱拍抑制权重
        const METER_CHANGE_PENALTY = 0.6; // 切换惩罚
        const BIAS_44 = 0.02;            // 4/4 偏好
        const HIST_W = 0.25;             // 历史分值权重

        // 初始化第一拍
        states.forEach(s => {
            const isDB = (s.p === 0);
            const str = beatStrength[0];
            // 允许第一拍在任何相位开始
            dp[0][s.id] = {
                s: isDB ? str : 0,
                c: isDB ? 1 : 0,
                su: isDB ? 0 : str,
                cu: isDB ? 0 : 1,
                a: isDB ? str : -UPBEAT_W * str,
                prev: null
            };
        });

        // 动态规划
        for (let i = 1; i < numBeats; i++) {
            const str = beatStrength[i];
            // 假设当前为curr模式
            states.forEach(curr => {
                let maxScore = -Infinity;
                let bestPrevId = null;
                let bestState = null;
                // 遍历所有可能的前驱模式
                states.forEach(prev => {
                    const pInfo = dp[i - 1][prev.id];
                    if (!pInfo) return;

                    // 物理顺序约束
                    let isSwitch = false;
                    if (prev.m === curr.m) {
                        // 节奏型相同，但相位不连续，不符合要求
                        if (curr.p !== (prev.p + 1) % curr.m) return;
                    } else {
                        // 只有在旧小节末尾且新小节开头才允许切换
                        if (prev.p === prev.m - 1 && curr.p === 0) isSwitch = true;
                        else return;
                    }
                    // 带有遗忘因子的统计量更新
                    const isDB = (curr.p === 0);
                    const nextC = pInfo.c * ALPHA + (isDB ? 1 : 0);
                    let nextSU = pInfo.su * ALPHA + (isDB ? 0 : str);
                    const nextS = pInfo.s * ALPHA + (isDB ? str : 0);
                    const nextCU = pInfo.cu * ALPHA + (isDB ? 0 : 1);
                    // 计算当前局部均值对比度
                    const avgDB = nextC > 0 ? nextS / nextC : 0;
                    const avgUP = nextCU > 0 ? nextSU / nextCU : 0;
                    let contrast = avgDB - (UPBEAT_W * avgUP);

                    // 切换惩罚
                    if (isSwitch) {
                        contrast *= METER_CHANGE_PENALTY;
                        // 仿射变换 降低对未来的相对影响
                        nextSU = nextSU * 1.05 + 4;
                    }
                    // 4/4偏好
                    if (curr.m === 4) contrast += BIAS_44;

                    // 混合历史与当前
                    const currentScore = pInfo.a * HIST_W + contrast * (1 - HIST_W);

                    if (currentScore > maxScore) {
                        maxScore = currentScore;
                        bestPrevId = prev.id;
                        bestState = {
                            s: nextS,
                            c: nextC,
                            su: nextSU,
                            cu: nextCU,
                            a: currentScore
                        };
                    }
                });
                if (bestPrevId !== null)
                    dp[i][curr.id] = { ...bestState, prev: bestPrevId };
            });
        }

        // 回溯
        let lastId = null;
        let maxA = -Infinity;
        states.forEach(s => {
            if (dp[numBeats - 1][s.id] && dp[numBeats - 1][s.id].a > maxA) {
                maxA = dp[numBeats - 1][s.id].a;
                lastId = s.id;
            }
        });

        const dbIdx = [], dbMeters = [];
        for (let i = numBeats - 1; i >= 0; i--) {
            if (!lastId) break;
            const [m, p] = lastId.split('-').map(Number);
            if (p === 0) { dbIdx.push(i); dbMeters.push(m); }
            lastId = dp[i][lastId].prev;
        }

        return [dbIdx.reverse(), dbMeters.reverse()];
    }
}