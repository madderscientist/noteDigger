/// <reference path="./dataProcess/fft_real.js" />
/// <reference path="./dataProcess/analyser.js" />
/// <reference path="./dataProcess/CQT/cqt.js" />
/// <reference path="./dataProcess/AI/basicamt.js" />
/// <reference path="./dataProcess/ANA.js" />

/**
 * 数据解析相关算法
 * @param {App} parent 
 */
function _Analyser(parent) {
    /**
     * 对audioBuffer执行STFT
     * @param {AudioBuffer} audioBuffer 音频缓冲区
     * @param {Number} tNum 一秒几次分析 决定步距
     * @param {Number} channel 选择哪个channel分析 0:left 1:right 2:l+r 3:l-r else:fft(l)+fft(r)
     * @param {Number} fftPoints 实数fft点数
     * @returns {Array<Float32Array>} 时频谱数据
     */
    this.stft = async (audioBuffer, tNum = 20, A4 = 440, channel = -1, fftPoints = 8192) => {
        parent.dt = 1000 / tNum;
        parent.TperP = parent.dt / parent._width; parent.PperT = parent._width / parent.dt;
        let dN = Math.round(audioBuffer.sampleRate / tNum);
        if (parent.Keyboard.freqTable.A4 != A4) parent.Keyboard.freqTable.A4 = A4;   // 更新频率表
        let progressTrans = (x) => x;   // 如果分阶段执行则需要自定义进度的变换

        // 创建分析工具
        var fft = new realFFT(fftPoints); // 8192点在44100采样率下，最低能分辨F#2，但是足矣
        var analyser = new NoteAnalyser(audioBuffer.sampleRate / fftPoints, parent.Keyboard.freqTable);

        const a = async (t) => { // 对t执行STFT，并整理为时频谱
            let nFinal = t.length - fftPoints;
            const result = new Array((nFinal / dN) | 0);
            const window_left = fftPoints >> 1; // 窗口左边界偏移量
            for (let n = dN >> 1, k = 0; n <= nFinal; n += dN) {    // n为窗口中心
                result[k++] = analyser.analyse(...fft.fft(t, n - window_left));
                // 一帧一次也太慢了。这里固定更新帧率
                let tnow = performance.now();
                if (tnow - lastFrame > 200) {
                    lastFrame = tnow;
                    // 打断分析 更新UI 等待下一周期
                    parent.event.dispatchEvent(new CustomEvent("progress", {
                        detail: progressTrans(k / (result.length - 1))
                    }));
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }   // 通知UI关闭的事件分发移到了audio.onloadeddata中
            return result;
        };

        await new Promise(resolve => setTimeout(resolve, 0));   // 等待UI
        var lastFrame = performance.now();
        const getEnergyData = async () => {
            switch (channel) {
                case 0: return await a(audioBuffer.getChannelData(0));
                case 1: return await a(audioBuffer.getChannelData(audioBuffer.numberOfChannels - 1));
                case 2: {   // L+R
                    let length = audioBuffer.length;
                    const timeDomain = new Float32Array(audioBuffer.getChannelData(0));
                    if (audioBuffer.numberOfChannels > 1) {
                        let channelData = audioBuffer.getChannelData(1);
                        for (let i = 0; i < length; i++) timeDomain[i] = (timeDomain[i] + channelData[i]) * 0.5;
                    } return await a(timeDomain);
                }
                case 3: {   // L-R
                    let length = audioBuffer.length;
                    const timeDomain = new Float32Array(audioBuffer.getChannelData(0));
                    if (audioBuffer.numberOfChannels > 1) {
                        let channelData = audioBuffer.getChannelData(1);
                        for (let i = 0; i < length; i++) timeDomain[i] = (timeDomain[i] - channelData[i]) * 0.5;
                    } return await a(timeDomain);
                }
                default: {  // fft(L) + fft(R)
                    if (audioBuffer.numberOfChannels > 1) {
                        progressTrans = (x) => x / 2;
                        const l = await a(audioBuffer.getChannelData(0));
                        progressTrans = (x) => 0.5 + x / 2;
                        const r = await a(audioBuffer.getChannelData(1));
                        for (let i = 0; i < l.length; i++) {
                            const li = l[i];
                            for (let j = 0; j < li.length; j++)
                                // 由于归一化，这里无需平均
                                li[j] += r[i][j];
                        } return l;
                    } else {
                        progressTrans = (x) => x;
                        return await a(audioBuffer.getChannelData(0));
                    }
                }
            }
        };
        return NoteAnalyser.normalize(await getEnergyData());
    };

    /**
     * 后台（worker）计算CQT
     * @param {AudioBuffer} audioBuffer 音频缓冲区
     * @param {Number} tNum 一秒几次分析 决定步距
     * @param {Number} channel 选择哪个channel分析 0:left 1:right 2:l+r 3:l-r else:fft(l)+fft(r)
     * @returns 不返回，直接作用于Spectrogram.spectrogram
     */
    this.cqt = (audioData, tNum, channel) => {
        if (window.location.protocol == 'file:' || window.cqt == undefined) return;    // 开worker和fetch要求http
        console.time("CQT计算");
        cqt(audioData, tNum, channel, parent.Keyboard.freqTable[0]).then((cqtData) => {
            // CQT结果准确但琐碎，STFT结果粗糙但平滑，所以混合一下
            const s = parent.Spectrogram.spectrogram;
            let tLen = Math.min(cqtData.length, s.length);
            for (let i = 0; i < tLen; i++) {
                const cqtBins = cqtData[i];
                const stftBins = s[i];
                for (let j = 0; j < cqtBins.length; j++) {
                    // 用非线性混合，当两者极大的时候取最大值，否则相互压制
                    if (stftBins[j] < cqtBins[j]) stftBins[j] = cqtBins[j];
                    else stftBins[j] = Math.sqrt(stftBins[j] * cqtBins[j]);
                }
            }
            console.timeEnd("CQT计算");
            parent.Spectrogram.spectrogram = s;  // 通知更新
        }).catch(console.error);
    };

    /**
     * 后台（worker）AI音色无关扒谱
     * @param {AudioBuffer} audioBuffer 音频缓冲区
     * @param {Boolean} judgeOnly 是否只判断是否可以扒谱
     * @returns promise，用于指示扒谱完成。如果judgeOnly为true则返回值代表是否可以AI扒谱
     */
    this.basicamt = (audioData, judgeOnly = false) => {
        if (window.location.protocol == 'file:' || window.basicamt == undefined) {  // 开worker和fetch要求https
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
        return basicamt(audioData).then((events) => {
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
        return septimbre(audioData, k).then((tracks) => {
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
    }
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
    }
}