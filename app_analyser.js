/// <reference path="./dataProcess/fft_real.js" />
/// <reference path="./dataProcess/analyser.js" />
/// <reference path="./dataProcess/CQT/cqt.js" />
/// <reference path="./dataProcess/AI/AIEntrance.js" />
/// <reference path="./dataProcess/ANA.js" />
/// <reference path="./dataProcess/bpmEst.js" />
/// <reference path="./dataProcess/NNLS.js" />

/**
 * 数据解析相关算法
 * @param {App} parent 
 */
function _Analyser(parent) {
    /**
     * 对audioBuffer执行STFT
     * @param {AudioBuffer} audioBuffer 音频缓冲区
     * @param {number} tNum 一秒几次分析 决定步距
     * @param {number} A4 频率表的A4频率
     * @param {number} channel 选择哪个channel分析 0:left 1:right 2:l+r 3:l-r else:fft(l)+fft(r)
     * @param {number} fftPoints 实数fft点数
     * @param {boolean} useGPU 是否使用GPU加速
     * @returns {Promise<Array<Float32Array>>} 时频谱数据
     */
    this.stft = async (audioBuffer, tNum = 20, A4 = 440, channel = -1, fftPoints = 8192, useGPU = true) => {// 8192点在44100采样率下，最低能分辨F#2，但是足矣
        parent.dt = 1000 / tNum;
        parent.TperP = parent.dt / parent._width; parent.PperT = parent._width / parent.dt;
        const dN = Math.round(audioBuffer.sampleRate / tNum);
        if (parent.Keyboard.freqTable.A4 != A4) parent.Keyboard.freqTable.A4 = A4;   // 更新频率表
        const channels = [];
        switch (channel) {
            case 0: channels.push(audioBuffer.getChannelData(0)); break;
            case 1: channels.push(audioBuffer.getChannelData(audioBuffer.numberOfChannels - 1)); break;
            case 2: { // L+R
                let length = audioBuffer.length;
                const timeDomain = new Float32Array(audioBuffer.getChannelData(0));
                if (audioBuffer.numberOfChannels > 1) {
                    let channelData = audioBuffer.getChannelData(1);
                    for (let i = 0; i < length; i++) timeDomain[i] = timeDomain[i] + channelData[i];
                } channels.push(timeDomain); break;
            }
            case 3: { // L-R
                let length = audioBuffer.length;
                const timeDomain = new Float32Array(audioBuffer.getChannelData(0));
                if (audioBuffer.numberOfChannels > 1) {
                    let channelData = audioBuffer.getChannelData(1);
                    for (let i = 0; i < length; i++) timeDomain[i] = timeDomain[i] - channelData[i];
                } channels.push(timeDomain); break;
            }
            default: { // fft(L)+fft(R)
                for (let c = 0; c < audioBuffer.numberOfChannels; c++)
                    channels.push(audioBuffer.getChannelData(c));
                break;
            }
        } let STFT;
        try {
            if (!useGPU) throw new Error("强制使用CPU计算STFT");
            STFT = await stftGPU(audioBuffer.sampleRate, channels, dN, fftPoints);
        } catch (e) {
            console.warn("GPU加速STFT失败,回退至CPU计算\n原因:", e.message);
            STFT = await stftCPU(audioBuffer.sampleRate, channels, dN, fftPoints);
        } return NoteAnalyser.normalize(STFT);
    }

    async function stftCPU(fs, channels, hop, fftPoints) {
        const progressPerChannel = 1 / channels.length;
        var progressTrans = (x) => x * progressPerChannel;   // 如果分阶段执行则需要自定义进度的变换
        const fft = new realFFT(fftPoints);
        const analyser = new NoteAnalyser(fs / fftPoints, parent.Keyboard.freqTable);
        const nbins = parent.Keyboard.freqTable.length;
        const a = async (t) => { // 对t执行STFT，并整理为时频谱
            let n = hop >> 1;
            const result = new Array(1 + (t.length - n) / hop | 0);
            const _data = new Float32Array(result.length * nbins);
            const window_left = fftPoints >> 1; // 窗口左边界偏移量
            for (let k = 0, sub = 0; n <= t.length; n += hop, sub += nbins) {    // n为窗口中心
                result[k++] = analyser.mel(...fft.fft(t, n - window_left), _data.subarray(sub, sub + nbins));
                // 一帧一次也太慢了。这里固定更新帧率
                let tnow = performance.now();
                if (tnow - lastFrame > 200) {
                    lastFrame = tnow;
                    // 打断分析 更新UI 等待下一周期
                    parent.event.dispatchEvent(new CustomEvent("progress", {
                        detail: progressTrans(k / result.length)
                    }));
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }   // 通知UI关闭的事件分发移到了audio.onloadeddata中
            result.raw = _data;
            return result;
        };
        await new Promise(resolve => setTimeout(resolve, 0));   // 等待UI
        var lastFrame = performance.now();
        const result = await a(channels[0]);
        for (let i = 1; i < channels.length; i++) {
            progressTrans = (x) => (i + x) * progressPerChannel;
            const other = (await a(channels[i])).raw;
            const raw = result.raw;
            for (let j = 0; j < raw.length; j++) raw[j] += other[j];
        } return result;
    };

    async function stftGPU(fs, channels, hop, fftPoints) {
        const stftGPU = new STFTGPU(fftPoints, hop);
        parent.event.dispatchEvent(new CustomEvent("progress", {
            detail: 0.4
        }));
        await stftGPU.initWebGPU();
        console.log("WebGPU初始化成功,使用GPU计算STFT");
        const analyser = new NoteAnalyser(fs / fftPoints, parent.Keyboard.freqTable);
        for (const c of channels) stftGPU.stft(c);
        const stftRes = await stftGPU.readGPU();
        stftGPU.free();
        const result = new Array(stftRes.length);
        const nbins = parent.Keyboard.freqTable.length;
        const _data = new Float32Array(result.length * nbins);
        for (let i = 0; i < stftRes.length; i++)
            result[i] = analyser.mel2(stftRes[i], _data.subarray(i * nbins, (i + 1) * nbins));
        result.raw = _data;
        return result;
    }

    /**
     * 后台（worker）计算CQT
     * @param {AudioBuffer} audioBuffer 音频缓冲区
     * @param {number} tNum 一秒几次分析 决定步距
     * @param {number} channel 选择哪个channel分析 0:left 1:right 2:l+r 3:l-r else:fft(l)+fft(r)
     * @param {boolean} useGPU 是否使用GPU加速计算CQT
     * @returns 不返回，直接作用于Spectrogram.spectrogram
     */
    this.cqt = (audioData, tNum, channel, useGPU = false) => {
        if (!parent.io.canUseExternalWorker || window.cqt == undefined) return; // 开worker和fetch要求http
        console.time("CQT计算");
        cqt(audioData, tNum, channel, parent.Keyboard.freqTable[0], useGPU).then((cqtData) => {
            // CQT结果准确但琐碎，STFT结果粗糙但平滑，所以混合一下
            const s = parent.Spectrogram.spectrogram;
            let tLen = Math.min(cqtData.length, s.length);
            for (let i = 0; i < tLen; i++) {
                const cqtBins = cqtData[i];
                const stftBins = s[i];
                for (let j = 0; j < cqtBins.length; j++) {
                    stftBins[j] = Math.sqrt(stftBins[j] * cqtBins[j]);
                }
            }
            console.timeEnd("CQT计算");
            parent.Spectrogram.spectrogram = s;  // 通知更新
        }).catch(console.error);
    };

    /**
     * 后台（worker）AI音色无关扒谱
     * @param {AudioBuffer} audioBuffer 音频缓冲区
     * @param {boolean} judgeOnly 是否只判断是否可以扒谱
     * @returns promise，用于指示扒谱完成。如果judgeOnly为true则返回值代表是否可以AI扒谱
     */
    this.basicamt = (audioData, judgeOnly = false) => {
        if (!parent.io.canUseExternalWorker || window.AI == undefined) {
            alert("file协议下无法使用AI扒谱！");
            return false;
        }
        if (!parent.Spectrogram._spectrogram) {
            alert('请导入音频或进入midi编辑模式！');
            return false;
        }
        if (!parent.MidiAction.channelDiv.colorMask) {
            alert("音轨不足！请至少删除一个音轨！");
            return false;
        }
        if (judgeOnly) return true;
        console.time("AI扒谱");
        return AI.basicamt(audioData).then((events) => {
            console.timeEnd("AI扒谱");
            const timescale = (256 * 1000) / (22050 * parent.dt); // basicAMT在22050Hz下以hop=256分析
            // 逻辑同index.html中导入midi
            const chdiv = parent.MidiAction.channelDiv;
            chdiv.switchUpdateMode(false);
            const ch = chdiv.addChannel();
            if (!ch) return;
            const chid = ch.index;
            ch.name = `AI扒谱${chid}`;
            ch.instrument = TinySynth.instrument[(ch.ch.instrument = 4)];
            const maxIntensity = events.reduce((a, b) => a.velocity > b.velocity ? a : b).velocity;
            ch.ch.volume = maxIntensity * 127;
            const notes = events.map(({ onset, offset, note, velocity }) => {
                return {
                    x1: onset * timescale,
                    x2: offset * timescale,
                    y: note - 24,
                    ch: chid,
                    selected: false,
                    v: velocity / maxIntensity * 127
                };
            });
            parent.MidiAction.midi.push(...notes);
            parent.MidiAction.midi.sort((a, b) => a.x1 - b.x1);
            chdiv.switchUpdateMode(true);
        }).catch(alert);
    };

    /**
     * 后台（worker）AI音色分离扒谱
     * @param {AudioBuffer} audioBuffer 音频缓冲区
     * @returns promise，用于指示扒谱完成
     */
    this.septimbre = (audioData, k = 2) => {
        console.time("AI音色分离扒谱");
        return AI.septimbre(audioData, k).then((tracks) => {
            console.timeEnd("AI音色分离扒谱");
            const timescale = (256 * 1000) / (22050 * parent.dt);
            // 逻辑同index.html中导入midi
            const chdiv = parent.MidiAction.channelDiv;
            chdiv.switchUpdateMode(false);
            tracks.forEach((events) => {
                const ch = chdiv.addChannel();
                if (!ch) return;
                const chid = ch.index;
                ch.name = `AI分离${chid}`;
                ch.instrument = TinySynth.instrument[(ch.ch.instrument = 4)];
                const maxIntensity = events.reduce((a, b) => a.velocity > b.velocity ? a : b).velocity;
                ch.ch.volume = maxIntensity * 127;
                const notes = events.map(({ onset, offset, note, velocity }) => {
                    return {
                        x1: onset * timescale,
                        x2: offset * timescale,
                        y: note - 24,
                        ch: chid,
                        selected: false,
                        v: velocity / maxIntensity * 127
                    };
                });
                parent.MidiAction.midi.push(...notes);
            });
            parent.MidiAction.midi.sort((a, b) => a.x1 - b.x1);
            chdiv.switchUpdateMode(true);
        }).catch(alert);
    };

    /**
     * “自动对齐音符”的入口 原理见 ~/dataProcess/aboutANA.md
     */
    this.autoNoteAlign = () => {
        if (!parent.Spectrogram._spectrogram || parent.midiMode) {
            alert('请先导入音频！');
            return false;
        }
        if (!parent.MidiAction.channelDiv.colorMask) {
            alert("音轨不足！请至少删除一个音轨！");
            return false;
        }
        let tempDiv = document.createElement('div');
        tempDiv.innerHTML = `
<div class="request-cover">
    <div class="card hvCenter">
        <div class="fr" style="align-items: center;">
            <label class="title">数字谱对齐音频</label>
            <span style="flex:1"></span>
            <button class="ui-cancel">取消</button>
        </div>
        <div class="layout">
            <button class="ui-cancel">降低八度</button>
            <span style="width: 1em;"></span>
            <button class="ui-cancel">升高八度</button>
        </div>
        <div class="layout">
            <textarea cols="35" rows="12" placeholder="\
输入没有时值的数字谱，算法将创建与音频同步的音符，相当于“数字谱+音频→midi”
数字谱的“1”对应于C5，请自行整体添加“[]”或“()”以升/降八度
建议先观察频谱，找到合适的八度。如果效果不好，也可以考虑升降后重试。
数字谱示例: ((b1)7)1 #2[#34b5]"></textarea>
        </div>
        <div class="layout">
            <button class="ui-confirm">重复区间内</button>
            <span style="width: 1em;"></span>
            <button class="ui-confirm">所有时间</button>
        </div>
    </div>
</div>`;
        const UI = tempDiv.firstElementChild;
        const textarea = UI.querySelector('textarea');
        const close = () => {
            UI.remove();
            parent.preventShortCut = false;
        }
        const btns = UI.getElementsByTagName('button');
        btns[0].onclick = close;
        btns[1].onclick = () => {
            textarea.value = '(' + textarea.value + ')';
        };
        btns[2].onclick = () => {
            textarea.value = '[' + textarea.value + ']';
        };
        btns[3].onclick = () => {   // 重复区间内
            const numberedScore = textarea.value.trim();
            if (!numberedScore) {
                alert("请输入数字谱！");
                return;
            }
            try {
                this._autoNoteAlign(
                    numberedScore,
                    parent.TimeBar.repeatStart / parent.dt,
                    parent.TimeBar.repeatEnd / parent.dt
                ); close();
            } catch (error) {
                alert(error.message);
            }
        };
        btns[4].onclick = () => {   // 所有时间
            const numberedScore = textarea.value.trim();
            if (!numberedScore) {
                alert("请输入数字谱！");
                return;
            }
            try {
                this._autoNoteAlign(numberedScore);
                close();
            } catch (error) {
                alert(error.message);
            }
        }
        parent.preventShortCut = true; // 禁止快捷键
        document.body.insertBefore(UI, document.body.firstChild);
    };
    this._autoNoteAlign = (noteSeq, begin, end) => {
        noteSeq = parseJE(noteSeq);
        let spectrum = parent.Spectrogram.spectrogram;
        if (begin != undefined) {
            begin = Math.max(0, Math.floor(begin));
            end = Math.min(spectrum.length, Math.ceil(end));
            spectrum = spectrum.slice(begin, end);
        } else begin = 0;
        if (noteSeq.length > spectrum.length) {
            throw new Error("数字谱长度超过频谱长度！（时长太短）");
        }
        // 插入间隔（用-1表示）
        const paddedNoteSeq = [-1];
        for (let i = 0; i < noteSeq.length; i++) {
            // 0对应C4
            paddedNoteSeq.push(noteSeq[i] + 48, -1);
        }
        const path = autoNoteAlign(paddedNoteSeq, spectrum, 100 / parent.dt);
        const chdiv = parent.MidiAction.channelDiv;
        chdiv.switchUpdateMode(false);
        const ch = chdiv.addChannel();
        if (!ch) return;
        const chid = ch.index;
        ch.name = `自动对齐${chid}`;
        for (let i = 0; i < path.length; ++i) {
            const [noteIdx, frameIdx] = path[i];
            const n = paddedNoteSeq[noteIdx];
            if (n == -1) continue;
            while (i < path.length && path[i][0] == noteIdx) ++i;
            --i;
            const frameEnd = path[i][1] + 1;
            parent.MidiAction.midi.push({
                y: n,
                x1: frameIdx + begin,
                x2: frameEnd + begin,
                ch: chid,
                selected: false,
            });
        }
        parent.MidiAction.midi.sort((a, b) => a.x1 - b.x1);
        chdiv.switchUpdateMode(true);
    };

    /**
     * 自动节拍检测并生成节拍线
     * @param {number} minBPM 最小BPM
     * @param {boolean} autoDownBeat 是否自动检测重拍位置
     * @returns {number} 全局估计的BPM值
     */
    this.beatEst = (minBPM = 40, autoDownBeat = false) => {
        const sr = Math.round(1000 / parent.dt);
        const onset = Beat.extractOnset(parent.Spectrogram.spectrogram, Math.min(0.99, 16 / sr));

        const maxInterval = Math.ceil(sr * 60 / minBPM);
        // 范围要大，所以方差大一些
        const global = Beat.corrBPM(SIGNAL.autoCorr(onset, maxInterval), sr, 1.4, 105);
        const tempo = Beat.tempo(onset, sr, minBPM, 12.8, 1.6, global);

        const fftSize = Beat.fs2FFTN(sr, 12.8);
        const pulse = Beat.PLP(onset, sr, [40, 200], fftSize, Math.max(1, fftSize >> 3), Beat.PLPprior(tempo, 0.1));
        for (let i = 0; i < pulse.length; i++) pulse[i] += onset[i];
        const beatIdx = Beat.EllisBeatTrack(pulse, sr, 300, tempo);
        if (beatIdx.length < 2) {
            alert("未能检测到有效节拍！");
            return;
        }
        if (beatIdx[0] == 0) beatIdx.shift();

        // 不能引入pulse的干扰 得用原始的onset
        const beatStrength = Beat.beatStrength(onset, beatIdx);
        const beatbar = parent.BeatBar.beats;
        if (autoDownBeat) { // 用动态规划求解重拍位置 但不够稳定
            const [downbeatIndices, downbeatMeters] = Beat.detectDownbeats(beatStrength, [2, 3, 4]);
            // 处理前面的拍
            beatbar.length = 0;
            let prev = 0, id = 0, i = 0;
            for (; i <= downbeatIndices[0]; i++, id++) {
                const at = beatIdx[i] * parent.dt;
                beatbar.push(new eMeasure(id, prev, 1, 4, at - prev));
                prev = at;
            }
            for (i = 0; i < downbeatIndices.length; i++, id++) {
                const pattern = downbeatMeters[i];
                const beatdown = downbeatIndices[i];
                if (i + 1 < downbeatIndices.length) {
                    const nextBeatdown = downbeatIndices[i + 1];
                    const endtime = beatIdx[nextBeatdown] * parent.dt;
                    beatbar.push(new eMeasure(id, prev, pattern, 4, endtime - prev));
                    prev = endtime;
                } else {
                    let endtime;
                    const time = beatIdx[beatIdx.length - 1] * parent.dt - prev;
                    const cnt = beatIdx.length - 1 - beatdown;
                    beatbar.push(new eMeasure(id, prev, pattern, 4, time / cnt * pattern));
                }
            }
        } else {   // 这两个估计结果有点差 暂时用1拍
            // const [g_pattern, g_beatdown] = Beat.rhythmicPattern(beatStrength, [2, 3, 4]);
            let g_pattern = 1, g_beatdown = 0;
            beatbar.length = 0;
            let prev = 0, id = 0, i = 0;
            // 前面的用单小节处理 注意应该有等号
            for (; i <= g_beatdown; i++, id++) {
                const at = beatIdx[i] * parent.dt;
                beatbar.push(new eMeasure(id, prev, 1, 4, at - prev));
                prev = at;
            }
            for (i = i - 1 + g_pattern; i < beatIdx.length; i += g_pattern, id++) {
                const at = beatIdx[i] * parent.dt;
                beatbar.push(new eMeasure(id, prev, g_pattern, 4, at - prev));
                prev = at;
            }
        }
        beatbar.check(true);
        parent.snapshot.save(0b100);
        parent.layers.action.dirty = true;
        // 如果正在用节拍则刷新节拍信息
        if (parent.AudioPlayer.audio.paused === false && parent.MidiPlayer._ifBeat) {
            parent.MidiPlayer.restart(true);
        }
        return global;
    };

    // 1(C4)->0
    function parseJE(txt) {
        const parts = [];
        let n = 0;
        let octave = 0;
        const JEnotes = ["1", "#1", "2", "#2", "3", "4", "#4", "5", "#5", "6", "#6", "7"];
        while (n < txt.length) {
            if (txt[n] == ')' || txt[n] == '[') ++octave;
            else if (txt[n] == '(' || txt[n] == ']') --octave;
            else {
                let m = 0;
                if (txt[n] == '#') m = 1;
                else if (txt[n] == 'b') m = -1;
                const noteEnd = n + Math.abs(m);
                const position = noteEnd < txt.length ? JEnotes.indexOf(txt[noteEnd]) : -1;
                if (position != -1) {
                    parts.push(m + position + octave * 12);
                    n = noteEnd;
                }
            }
            ++n;
        } return parts;
    };

    this.reduceHarmonic = () => {
        let resolve, reject;
        let p = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        let tempDiv = document.createElement('div');
        tempDiv.innerHTML = `<div class="request-cover">
<div class="card hvCenter">
    <label class="title">谐波去除 <span style="font-size: 0.6em; color: grey;">非负最小二乘法</span></label>
    <div class="layout">
        <span class="labeled" data-tooltip="对谐波强度的估计">谐波衰减率</span>
        <input type="number" value="0.6" step="0.01" min="0.1" max="0.9">
    </div>
    <div class="layout">
        <span class="labeled" data-tooltip="考虑的谐波数量">谐波数量</span>
        <input type="number" value="10" step="1" min="4" max="16">
    </div>
    <div class="layout">
        <label class="labeled" data-tooltip="修改频谱 不可逆">
            原位操作<input type="checkbox">
        </label>
    </div>
    <div class="layout">
        <button class="ui-cancel">取消</button>
        <span style="width: 1em;"></span>
        <button class="ui-confirm">确认</button>
    </div>
</div></div>`;
        const UI = tempDiv.firstElementChild;
        const inputs = UI.querySelectorAll('input[type="number"]');
        const decayInput = inputs[0];
        const harmonicsInput = inputs[1];
        const cancelBtn = UI.querySelector('.ui-cancel');
        const inplace = UI.querySelector('input[type="checkbox"]');
        const confirmBtn = UI.querySelector('.ui-confirm');
        cancelBtn.onclick = () => {
            UI.remove();
            resolve(false);
        };
        confirmBtn.onclick = () => {
            let decay = parseFloat(decayInput.value);
            if (decay < 0.1 || decay > 0.9) {
                alert("衰减率必须在0.1到0.9之间！");
                return;
            }
            let harmonics = parseInt(harmonicsInput.value);
            if (harmonics < 4 || harmonics > 16) {
                alert("谐波数量必须在4到16之间！");
                return;
            }
            UI.remove();
            this._reduceHarmonic(decay, harmonics, inplace.checked).then(() => {
                resolve(true);
            }).catch(reject);
        }
        document.body.insertBefore(UI, document.body.firstChild);
        return p;
    };
    /**
     * 利用非负最小二乘去除频谱中的谐波成分并补偿基频 在幅度谱上进行
     * 如果inplace为true则直接修改Spectrogram.spectrogram 否则会存储谐波成分矩阵于Spectrogram.harmonic
     * 原理是将谐波模板（每个音符的基频和若干个谐波）作为特征，拟合出每一帧中各个音符的强度，然后将这些音符的谐波成分从频谱中减去
     * @param {number} decay 谐波衰减率，默认0.6，越大去除越彻底但可能过度拟合
     * @param {number} harmonics 谐波数量
     * @param {boolean} inplace 是否直接在原频谱上减去谐波 还是单独存储谐波成分
     */
    this._reduceHarmonic = async (decay = 0.6, harmonics = 10, inplace = false) => {
        const container = document.createElement('div');
        container.innerHTML = `<div class="request-cover">
<div class="card hvCenter"><label class="title">分析中</label>
    <span>00%</span>
    <div class="layout">
        <div class="porgress-track">
            <div class="porgress-value"></div>
        </div>
    </div>
</div></div>`;
        const progressUI = container.firstElementChild;
        const progress = progressUI.querySelector('.porgress-value');
        const percent = progressUI.querySelector('span');
        document.body.insertBefore(progressUI, document.body.firstChild);
        const onprogress = (detail) => {
            if (detail < 0) {
                progress.style.width = '100%';
                percent.textContent = '100%';
                progressUI.style.opacity = 0;
                setTimeout(() => progressUI.remove(), 200);
            } else if (detail >= 1) {
                detail = 1;
                progress.style.width = '100%';
                percent.textContent = "加载界面……";
            } else {
                progress.style.width = (detail * 100) + '%';
                percent.textContent = (detail * 100).toFixed(2) + '%';
            }
        };
        var lastFrame = performance.now();

        const s = parent.Spectrogram._spectrogram;
        const M = s[0].length, N = s.length;
        const M1 = M + 1;
        // 创建音符谐波模板
        let harmonicAmp = Array.from({ length: harmonics }, (_, i) => decay ** i);
        const Harmonic = new Float32Array(M);
        for (let i = 0; i < harmonicAmp.length; i++) {
            const idx = 12 * Math.log2(i + 1);
            let l = Math.floor(idx), r = Math.ceil(idx);
            if (r < M) {
                if (l == r) Harmonic[l] = harmonicAmp[i];
                else {
                    Harmonic[l] += harmonicAmp[i] * (r - idx);
                    Harmonic[r] += harmonicAmp[i] * (idx - l);
                }
            }
        }
        // 填充到模板矩阵A
        const A = new Float32Array(M * M);
        for (let i = 0; i < M; i++)
            A.set(Harmonic.subarray(0, M - i), i * M1);
        // 模式选择
        if (!inplace) {
            harmonicAmp = Array(N);
            harmonicAmp.raw = new Float32Array(N * M);
        } else harmonicAmp = null;
        // 对每一帧执行NNLS
        const nnls = new NNLSSolver(M, M, 2e-4, Harmonic);
        for (let t = 0; t < N; t++) {
            const f = s[t];
            const c = nnls.solve(A, f);
            // 计算谐波
            Harmonic.fill(0);
            for (let i = 0; i < M; i++) {
                const a = i + 12;   // start at 2f0
                const off = i * M + a;
                let f0h = 0;
                for (let j = 0; j < M - a; j++) {
                    let amp = A[off + j] * c[i];
                    f0h += amp * amp;
                    Harmonic[a + j] += amp;
                };
                // 加强基频。∵L2<L1 ∴此处用L2对基频小幅补偿
                Harmonic[i] -= Math.sqrt(f0h);
            }
            if (inplace) { // 从原始频谱中减去谐波
                for (let i = 0; i < M; i++) f[i] = Math.max(0, f[i] - Harmonic[i]);
            } else { // 存储谐波成分
                let a = harmonicAmp[t] = harmonicAmp.raw.subarray(t * M, (t + 1) * M);
                a.set(Harmonic);
            }
            // UI更新
            let tnow = performance.now();
            if (tnow - lastFrame > 200) {
                onprogress(t / N);
                await new Promise(resolve => setTimeout(resolve, 0));   // 等待UI
                lastFrame = tnow;
            }
        }
        if (!inplace) parent.Spectrogram.harmonic = harmonicAmp;
        parent.layers.spectrum.dirty = true;
        onprogress(-1);
    };
}