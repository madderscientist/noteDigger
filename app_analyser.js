/// <reference path="./dataProcess/fft_real.js" />
/// <reference path="./dataProcess/analyser.js" />
/// <reference path="./dataProcess/CQT/cqt.js" />
/// <reference path="./dataProcess/AI/basicamt.js" />

/**
 * 数据解析相关
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
    const _stft = async (audioBuffer, tNum = 20, A4 = 440, channel = -1, fftPoints = 8192) => {
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
    const _cqt = (audioData, tNum, channel) => {
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
        }).catch(console.error);
    };

    this.onfile = (file) => {     // 依赖askUI.css
        let midimode = file == void 0;  // 在确认后才能parent.midiMode=midimode
        if (midimode) {      // 不传则说明是midi编辑器模式
            file = { name: "MIDI编辑器模式" };
        } else if (!(file.type.startsWith('audio/') || file.type.startsWith('video/'))) {
            parent.event.dispatchEvent(new Event('fileerror'));
            return;
        }
        if (parent.Spectrogram._spectrogram && !confirm("本页面已加载音频，是否替换？")) {
            return;
        }
        parent.event.dispatchEvent(new Event('fileui'));
        let tempDiv = document.createElement('div');
        // 为了不影响下面的事件绑定，midi模式下用display隐藏
        tempDiv.innerHTML = `
<div class="request-cover">
    <div class="card hvCenter"><label class="title">${file.name}</label>&nbsp;&nbsp;<button class="ui-cancel"${midimode ? ' style="display:none;"' : ''}>使用已有结果</button>
        <div class="layout"><span>每秒的次数：</span><input type="number" name="ui-ask" value="20" min="1" max="100"></div>
        <div class="layout"><span>标准频率A4=</span><input type="number" name="ui-ask" value="440" step="0.1" min="55"></div>
        <div class="layout"${midimode ? ' style="display:none;"' : ''}>分析声道：</div>
        <div class="layout"${midimode ? ' style="display:none;"' : ''}>
            <input type="radio" name="ui-ask" value="4" checked>Stereo
            <input type="radio" name="ui-ask" value="2">L+R
            <input type="radio" name="ui-ask" value="3">L-R
            <input type="radio" name="ui-ask" value="0">L
            <input type="radio" name="ui-ask" value="1">R
        </div>
        <div class="layout"><button class="ui-cancel">取消</button><button class="ui-confirm">${midimode ? '确认' : '解析'}</button></div>
    </div>
</div>`;
        parent.AudioPlayer.name = file.name;
        const ui = tempDiv.firstElementChild;
        function close() { ui.remove(); }
        let btns = ui.getElementsByTagName('button');
        btns[0].onclick = () => {
            close();
            const input = document.createElement("input");
            input.type = "file";
            input.onchange = () => {
                parent.Saver.parse(input.files[0]).then((data) => {
                    // 再读取音频看看是否成功
                    const fileReader = new FileReader();
                    fileReader.onload = (e) => {
                        // 设置音频源 缓存到浏览器
                        parent.AudioPlayer.createAudio(e.target.result).then(() => {
                            if (parent.AudioPlayer.name != data[0].name &&
                                !confirm(`音频文件与分析结果(${data[0].name})不同，是否继续？`))
                                return;
                            parent.Saver.import(data);
                            // 触发html中的iniEQUI
                            parent.event.dispatchEvent(new CustomEvent('progress', { detail: -1 }));
                        });
                    }; fileReader.readAsDataURL(file);
                }).catch((e) => {
                    parent.event.dispatchEvent(new Event('fileerror'));
                });
            }; input.click();
        };
        btns[1].onclick = () => {
            close();
            parent.event.dispatchEvent(new Event('filecancel'));  // 为了恢复drag功能
        };
        btns[2].onclick = () => {
            // 获取分析参数
            const params = ui.querySelectorAll('[name="ui-ask"]');  // getElementsByName只能在document中用
            let tNum = params[0].value;
            let A4 = params[1].value;
            let channel = 4;
            for (let i = 2; i < 7; i++) {
                if (params[i].checked) {
                    channel = parseInt(params[i].value);
                    break;
                }
            }
            close();
            parent.midiMode = midimode;
            //==== midi模式 ====//
            if (midimode) {
                // 在Anaylse中的设置全局的
                parent.dt = 1000 / tNum;
                parent.TperP = parent.dt / parent._width; parent.PperT = parent._width / parent.dt;
                if (parent.Keyboard.freqTable.A4 != A4) parent.Keyboard.freqTable.A4 = A4;
                let l = Math.ceil((parent.spectrum.width << 1) / parent.width);   // 视野外还有一面
                // 一个怎么取值都返回0的东西，充当频谱
                parent.Spectrogram.spectrogram = new Proxy({
                    spectrogram: new Uint8Array(parent.ynum).fill(0),
                    _length: l,
                    get length() { return this._length; },
                    set length(l) { // 只要改变频谱的长度就可以改变时长 长度改变在MidiAction.updateView中
                        if (l < 0) return;
                        this._length = parent.xnum = l;
                        parent.AudioPlayer.audio.duration = l / tNum;
                        parent.AudioPlayer.play_btn.lastChild.textContent = parent.AudioPlayer.durationString;
                    }
                }, {
                    get(obj, prop) {    // 方括号传递的总是string
                        if (isNaN(Number(prop))) return obj[prop];
                        return obj.spectrogram;
                    },
                    set(obj, prop, value) {
                        if (isNaN(Number(prop))) obj[prop] = value;
                    }
                });
                // 假音频 需要设置parent.midiMode=true;
                parent.AudioPlayer.createAudio(l / tNum);
                return;
            }
            //==== 音频文件分析 ====//
            parent.event.dispatchEvent(new Event('fileaccept'));
            // 打开另一个ui analyse加入回调以显示进度
            let tempDiv = document.createElement('div');
            tempDiv.innerHTML = `
<div class="request-cover">
    <div class="card hvCenter"><label class="title">解析中</label>
        <span>00%</span>
        <div class="layout">
            <div class="porgress-track">
                <div class="porgress-value"></div>
            </div>
        </div>
    </div>
</div>`;
            const progressUI = tempDiv.firstElementChild;
            const progress = progressUI.querySelector('.porgress-value');
            const percent = progressUI.querySelector('span');
            document.body.insertBefore(progressUI, document.body.firstChild);
            const onprogress = ({ detail }) => {
                if (detail < 0) {
                    parent.event.removeEventListener('progress', onprogress);
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
            parent.event.addEventListener('progress', onprogress);
            // 读取文件
            let audioData;
            const fileReader = new FileReader();
            fileReader.onload = (e) => {
                // 解码音频文件为音频缓冲区
                parent.audioContext.decodeAudioData(e.target.result).then((decodedData) => {
                    audioData = decodedData;
                    return Promise.all([
                        _stft(decodedData, tNum, A4, channel, 8192),
                        parent.AudioPlayer.createAudio(URL.createObjectURL(file)) // fileReader.readAsDataURL(file) 将mov文件decode之后变成base64，audio无法播放 故不用
                    ]);
                }).then(([v, audio]) => {
                    parent.Spectrogram.spectrogram = v;
                }).catch((e) => {
                    alert(e); console.error(e);
                    parent.event.dispatchEvent(new Event('fileerror'));
                }).finally(() => {
                    // 最终都要关闭进度条
                    parent.event.dispatchEvent(new CustomEvent('progress', { detail: -1 }));
                    // 后台执行CQT
                    _cqt(audioData, tNum, channel);
                });
            }; fileReader.readAsArrayBuffer(file);
        };
        document.body.insertBefore(ui, document.body.firstChild);   // 插入body的最前面
    };

    /**
     * 后台（worker）AI扒谱
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
}