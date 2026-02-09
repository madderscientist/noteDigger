/// <reference path="./saver.js" />
/// <reference path="./midi.js" />

/**
 * 文件相关操作
 * @param {App} parent 
 */
function _IO(parent) {
    this.canUseExternalWorker = typeof window.Worker !== 'undefined' && window.location.protocol !== 'file:';
    // midi模式下的假音频
    function fakeInput(l = 0, tNum = 1000 / parent.dt) {
        if (!l || l <= 0) l = Math.ceil((parent.layers.width << 1) / parent.width);
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
            },
            *[Symbol.iterator]() {
                for (let i = 0; i < this.length; i++) yield this.spectrogram;
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
        return parent.AudioPlayer.createAudio(l / tNum);
    }

    /**
     * 会发出如下event:
     * - fileui: 展示本函数的UI，需要外界关闭drag功能
     * - fileuiclose: UI关闭，外界恢复drag功能
     * - fileerror: 文件解析错误，外界提示用户; detail为Error对象
     * - progress: 解析进度，detail为0~1的数字，-1表示完成
     * event的意义是可以反复触发（比如进度文件错误可重试），而返回值的promise只能触发一次
     * @param {File} file 音频文件 如果不传则进入midi编辑器模式
     * @returns Promise 指示用户操作完成，即UI关闭
     */
    this.onfile = (file) => {     // 依赖askUI.css
        let midimode = file == void 0;    // 在确认后才能parent.midiMode=midimode
        if (midimode) {      // 不传则说明是midi编辑器模式
            file = { name: "MIDI编辑模式" };
        } else if (!(file.type.startsWith('audio/') || file.type.startsWith('video/'))) {
            parent.event.dispatchEvent(new CustomEvent('fileerror', { detail: new Error("不支持的文件类型") }));
            return Promise.reject();
        } else if (file.type == "audio/mid") {
            if (parent.Spectrogram._spectrogram) {
                this.midiFile.import(file);
                return Promise.resolve();
            }
            // 没有设置时间精度，先弹设置UI
            return this.onfile().then(() => {
                this.midiFile.import(file);
            });
        }
        if (parent.Spectrogram._spectrogram && !confirm("本页面已加载音频，是否替换？")) {
            return Promise.reject();
        }

        // 指示是否完成
        let resolve, reject;
        const donePromise = new Promise((res, rej) => { resolve = res; reject = rej; });
        const loadAudio = (URLmode = true) => new Promise((res, rej) => {
            const fileReader = new FileReader();
            // 音频文件错误标志本次会话结束
            // 调用loadAudio不需要再写catch
            fileReader.onerror = (e) => {
                parent.event.dispatchEvent(new CustomEvent('fileerror', { detail: e }));
                console.error("FileReader error", e);
                reject(e);
                rej(e);
            };
            fileReader.onload = (e) => {
                res(e.target.result);
            };
            if (URLmode) fileReader.readAsDataURL(file);
            else fileReader.readAsArrayBuffer(file);
        });

        parent.event.dispatchEvent(new Event('fileui'));    // 关闭drag功能
        let tempDiv = document.createElement('div');
        // 为了不影响下面的事件绑定，midi模式下用display隐藏
        const midiModeStyle = midimode ? ' style="display:none;"' : '';
        tempDiv.innerHTML = `
<div class="request-cover">
    <div class="card hvCenter">
        <span class="title" style="text-align: center;">${file.name}</span>
        <button class="ui-cancel"${midiModeStyle}>使用已有结果</button>
        <div class="layout"><span>每秒的次数：</span><input type="number" name="ui-ask" value="20" min="1" max="100"></div>
        <div class="layout"><span>标准频率A4=</span><input type="number" name="ui-ask" value="440" step="0.1" min="55"></div>
        <div${midiModeStyle}>
            <div class="layout">分析声道：
                <label class="labeled" data-tooltip="快,只是进度条没动画">GPU加速<input type="checkbox" id="stft-gpu" checked></label>
            </div>
            <div class="layout">
                <input type="radio" name="ui-ask" value="4" checked>Stereo
                <input type="radio" name="ui-ask" value="2">L+R
                <input type="radio" name="ui-ask" value="3">L-R
                <input type="radio" name="ui-ask" value="0">L
                <input type="radio" name="ui-ask" value="1">R
            </div>
            <div class="layout"${this.canUseExternalWorker ? '' : ' style="display:none;"'}>
                <label class="labeled" data-tooltip="CQT分析更精准,将在后台进行">
                    后台计算CQT<input type="checkbox" id="calc-cqt" checked>
                </label>
                <label class="labeled" data-tooltip="GPU更快,但中途页面易卡顿">
                    优先用GPU算CQT<input type="checkbox" id="prefer-gpu">
                </label>
            </div>
        </div>
        <div class="layout">
            <button class="ui-cancel">取消</button>
            <span style="width: 1em;"></span>
            <button class="ui-confirm">${midimode ? '确认' : '解析'}</button>
        </div>
    </div>
</div>`;
        parent.AudioPlayer.name = file.name;
        const ui = tempDiv.firstElementChild;
        const close = () => ui.remove();
        const checkboxSTFTGPU = ui.querySelector('#stft-gpu');
        const checkboxCQT = ui.querySelector('#calc-cqt');
        const checkboxGPU = ui.querySelector('#prefer-gpu');
        checkboxCQT.onchange = () => {
            checkboxGPU.parentElement.style.display = checkboxCQT.checked ? 'block' : 'none';
        };
        const btns = ui.getElementsByTagName('button');
        btns[0].onclick = () => {   // 进度上传
            const input = document.createElement("input");
            input.type = "file";
            input.onchange = () => {
                parent.io.projFile.parse(input.files[0]).then((data) => {
                    if (parent.AudioPlayer.name != data[0].name &&
                        !confirm(`音频文件与进度(${data[0].name})不同，是否继续？`))
                        return;
                    // 如果保存的是midi模式，则data[1]是都为undefined的数组
                    if (Array.isArray(data[1]) && data[1][0] === void 0) {
                        parent.io.projFile.import(data);
                        fakeInput().then(resolve).catch(reject);
                        return;
                    }
                    // 再读取音频看看是否成功
                    loadAudio(true).then((audioBuffer) => {
                        // 设置音频源 缓存到浏览器
                        parent.AudioPlayer.createAudio(audioBuffer).then(() => {
                            parent.io.projFile.import(data);
                            // 触发html中的iniEQUI
                            parent.event.dispatchEvent(new CustomEvent('progress', { detail: -1 }));
                            resolve();
                        }).catch((e) => {
                            parent.event.dispatchEvent(new CustomEvent('fileerror', { detail: e }));
                            console.error("AudioPlayer error", e);
                            reject(e);
                        }).finally(() => {
                            close();    // 不管音频结果如何都要关闭UI
                            parent.event.dispatchEvent(new Event('fileuiclose'));  // 恢复drag功能
                        });
                    });
                }).catch((e) => {
                    // 进度文件错误，允许重试，不reject
                    parent.event.dispatchEvent(new CustomEvent('fileerror', { detail: e }));
                });
            }; input.click();
        };
        btns[1].onclick = () => {   // 取消按钮
            close();
            parent.event.dispatchEvent(new Event('fileuiclose'));  // 恢复drag功能
            resolve(false);
        };
        btns[2].onclick = () => {   // 确认按钮
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
                fakeInput(0, tNum).then(resolve).catch(reject);
                parent.event.dispatchEvent(new Event('fileuiclose'));  // 恢复drag功能
                return;
            }

            //==== 音频文件分析 ====//
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
            loadAudio(false).then((audioBuffer) => {
                let audioData;
                // 解码音频文件为音频缓冲区
                parent.audioContext.decodeAudioData(audioBuffer).then((decodedData) => {
                    audioData = decodedData;
                    return Promise.all([
                        parent.Analyser.stft(decodedData, tNum, A4, channel, 8192, checkboxSTFTGPU.checked),
                        parent.AudioPlayer.createAudio(URL.createObjectURL(file)) // fileReader.readAsDataURL(file) 将mov文件decode之后变成base64，audio无法播放 故不用
                    ]);
                }).then(([v, audio]) => {
                    parent.Spectrogram.spectrogram = v;
                    resolve();
                    // 后台执行CQT CQT的报错已经被拦截不会冒泡到下面的catch中
                    parent.Analyser.cqt(audioData, tNum, channel, checkboxCQT.checked && checkboxGPU.checked);
                }).catch((e) => {
                    console.error(e);
                    parent.event.dispatchEvent(new CustomEvent('fileerror', { detail: e }));
                    reject(e);
                }).finally(() => {
                    // 最终都要关闭进度条
                    parent.event.dispatchEvent(new CustomEvent('progress', { detail: -1 }));
                    parent.event.dispatchEvent(new Event('fileuiclose'));  // 恢复drag功能
                });
            });
        };
        document.body.insertBefore(ui, document.body.firstChild);   // 插入body的最前面
        ui.focus();
        return donePromise;
    };

    // 进度文件
    this.projFile = {
        export() {
            if (!parent.Spectrogram._spectrogram) return null;
            const data = {
                midi: parent.MidiAction.midi,
                channel: parent.MidiAction.channelDiv.channel,
                beat: parent.BeatBar.beats,
                dt: parent.dt,
                A4: parent.Keyboard.freqTable.A4,
                name: parent.AudioPlayer.name
            };
            if (parent.midiMode) return [data, {
                length: parent.Spectrogram._spectrogram.length
            }]; // midi模式不保存频谱
            else return [data, parent.Spectrogram._spectrogram];
        },
        import(data) {  // data: output of parse [obj, f32]
            const obj = data[0];
            parent.MidiAction.midi = obj.midi;
            parent.MidiAction.selected = parent.MidiAction.midi.filter((obj) => obj.selected);
            parent.MidiAction.channelDiv.fromArray(obj.channel);
            parent.BeatBar.beats.copy(obj.beat);
            parent.dt = obj.dt;
            parent.Keyboard.freqTable.A4 = obj.A4;
            parent.Spectrogram.spectrogram = data[1];
            parent.snapshot.save();
        },
        write(fileName = parent.AudioPlayer.name) {
            const data = this.export();
            bSaver.saveArrayBuffer(bSaver.combineArrayBuffers([
                bSaver.String2Buffer("noteDigger"),
                bSaver.Object2Buffer(data[0]),
                bSaver.Float32Mat2Buffer(data[1])
            ]), fileName + '.nd');
        },
        parse(file) {
            return new Promise((resolve, reject) => {
                bSaver.readBinary(file, (b) => {
                    let [name, o] = bSaver.Buffer2String(b, 0);
                    if (name != "noteDigger") {
                        reject(new Error("incompatible file!"));
                        return;
                    }
                    let [obj, o1] = bSaver.Buffer2Object(b, o);
                    let [f32, _] = bSaver.Buffer2Float32Mat(b, o1);
                    resolve([obj, f32]);
                });
            });
        }
    };

    // midi文件
    this.midiFile = {
        export: {
            UI() {
                let tempDiv = document.createElement('div');
                tempDiv.innerHTML = `
<div class="request-cover">
    <div class="card hvCenter" style="overflow: visible;"><label class="title">导出为midi</label>
        <div class="layout"><button class="ui-confirm labeled" data-tooltip="可用于制谱；可能会损失、扭曲一些信息">导出时节奏对齐</button></div>
        <div class="layout"><button class="ui-confirm labeled" data-tooltip="保证播放起来和这里一模一样，但丢失节奏信息">和听起来一样</button></div>
        <div class="layout">仅导出可见音轨<input type="checkbox"></div>
        <div class="layout"><button class="ui-cancel">取消</button></div>
    </div>
</div>`;
                const card = tempDiv.firstElementChild;
                const close = () => { card.remove(); };
                const checkbox = card.querySelector('input[type="checkbox"]');
                const btns = card.querySelectorAll('button');
                btns[0].onclick = () => {
                    const midi = this.beatAlign(checkbox.checked);
                    bSaver.saveArrayBuffer(midi.export(1), midi.name + '.mid');
                    close();
                };
                btns[1].onclick = () => {
                    const midi = this.keepTime(checkbox.checked);
                    bSaver.saveArrayBuffer(midi.export(1), midi.name + '.mid');
                    close();
                };
                btns[2].onclick = close;
                document.body.insertBefore(card, document.body.firstChild);
                card.tabIndex = 0;
                card.focus();
            },
            /**
             * 100%听感还原扒谱结果，但节奏是乱的
             */
            keepTime(onlyVisible = false) {
                const accuracy = 10;
                const newMidi = new midi(60, [4, 4], Math.round(1000 * accuracy / parent.dt), [], parent.AudioPlayer.name);
                const mts = [];
                for (const ch of parent.synthesizer.channel) {
                    let mt = newMidi.addTrack();
                    mt.addEvent(midiEvent.instrument(0, ch.instrument));
                    mt._volume = ch.volume;
                    mts.push(mt);
                }
                for (const nt of parent.MidiAction.midi) {
                    if (onlyVisible && !parent.MidiAction.channelDiv.channel[nt.ch].visible) continue;
                    const midint = nt.y + 24;
                    let v = mts[nt.ch]._volume;
                    if (nt.v) v = Math.min(127, v * nt.v / 127);
                    mts[nt.ch].addEvent(midiEvent.note(nt.x1 * accuracy, (nt.x2 - nt.x1) * accuracy, midint, v));
                } return newMidi;
            },
            beatAlign(onlyVisible = false) {
                // 初始化midi
                let begin = parent.BeatBar.beats[0];
                let lastbpm = begin.bpm;    // 用于自适应bpm
                let lastPattern = `${begin.beatNum}/${begin.beatUnit}`;
                const newMidi = new midi(lastbpm, [begin.beatNum, begin.beatUnit], 480, [], parent.AudioPlayer.name);
                const mts = [];
                for (const ch of parent.synthesizer.channel) {
                    let mt = newMidi.addTrack();
                    mt.addEvent(midiEvent.instrument(0, ch.instrument));
                    mt._volume = ch.volume;
                    mts.push(mt);
                }
                // 将每个音符拆分为两个时刻
                const Midis = parent.MidiAction.midi;
                const mlen = Midis.length << 1;
                const moment = new Array(mlen);
                for (let i = 0, j = 0; i < mlen; j++) {
                    const nt = Midis[j];
                    let duration = nt.x2 - nt.x1;
                    let midint = nt.y + 24;
                    let v = mts[nt.ch]._volume;
                    if (nt.v) v = Math.min(127, v * nt.v / 127);
                    moment[i++] = new midiEvent({
                        _d: duration,
                        ticks: nt.x1,
                        code: 0x9,
                        value: [midint, v],
                        _ch: nt.ch
                    }, true);
                    moment[i++] = new midiEvent({
                        _d: duration,
                        ticks: nt.x2,
                        code: 0x9,
                        value: [midint, 0],
                        _ch: nt.ch
                    }, true);
                } moment.sort((a, b) => a.ticks - b.ticks);
                // 对每个小节进行对齐
                let m_i = 0;    // moment的指针
                let tickNow = 0;    // 维护总时长
                for (const measure of parent.BeatBar.beats) {
                    if (m_i == mlen) break;

                    //== 判断小节是否变化 假设小节之间bpm相关性很强 ==//
                    const bpmnow = measure.bpm;
                    if (Math.abs(bpmnow - lastbpm) > lastbpm * 0.065) {
                        mts[0].events.push(midiEvent.tempo(tickNow, bpmnow * 4 / measure.beatUnit));
                    } lastbpm = bpmnow;
                    const _ptn = `${measure.beatNum}/${measure.beatUnit}`;
                    if (lastPattern !== _ptn) {
                        mts[0].events.push(midiEvent.time_signature(tickNow, measure.beatNum, measure.beatUnit));
                    } lastPattern = _ptn;

                    //== 对齐音符 ==//
                    const begin = measure.start / parent.dt;   // 转换为以“格”为单位
                    const end = (measure.interval + measure.start) / parent.dt;
                    // 一个八音符的格数
                    const aot = measure.interval * measure.beatUnit / (measure.beatNum * 8 * parent.dt);
                    while (m_i < mlen) {
                        const n = moment[m_i];
                        if (n.ticks > end) break;    // 给下一小节
                        m_i++;
                        if (onlyVisible && !parent.MidiAction.channelDiv.channel[n._ch].visible) continue;
                        const threshold = n._d / 2;
                        let accuracy = aot;
                        while (accuracy > threshold) accuracy /= 2;
                        n.ticks = tickNow + ((Math.round((n.ticks - begin) / accuracy) * newMidi.tick * accuracy / aot) >> 1);
                        mts[n._ch].events.push(n);
                    } tickNow += newMidi.tick * measure.beatNum * 4 / measure.beatUnit;
                } return newMidi;
            }
        },
        /* 由于小节的数据结构，变速只能发生在小节开头
        如果考虑节奏，则需要将小节内变速全部忽略
        */
        import(file) {
            bSaver.readBinary(file, (data) => {
                let m;
                try {
                    m = midi.import(new Uint8Array(data)).JSON();
                } catch (error) {
                    console.error("Error importing MIDI:", error);
                    alert("导入MIDI文件时出错");
                    return;
                }
                const chdiv = parent.MidiAction.channelDiv;
                chdiv.switchUpdateMode(false);  // 下面会一次性创建大量音符，所以先关闭更新
                let tickTimeTable = m.header.tempos ?? [{
                    ticks: 0, bpm: 120
                }];

                if (confirm("是否使用该MIDI的节奏?")) { // 对齐变速和节奏
                    // 将节奏型和变速事件合并排序
                    let rhy = [{ticks: -1, timeSignature: [4, 4]}, ...tickTimeTable, ...m.header.timeSignatures];
                    rhy.sort((a, b) => a.ticks - b.ticks);
                    rhy[0].ticks = 0;
                    // 合并时间相同的
                    let combined = [];
                    for (let i = 0; i < rhy.length; i++) {
                        const t = rhy[i].ticks;
                        let timeSignature = rhy[i].timeSignature;
                        let bpm = rhy[i].bpm;
                        let j = i + 1;
                        while (j < rhy.length && rhy[j].ticks == t) {
                            bpm = rhy[j].bpm ?? bpm;    // 使用最新值
                            timeSignature = rhy[j].timeSignature ?? timeSignature;
                            j++;
                        }
                        combined.push({
                            ticks: t,
                            bpm: bpm,
                            timeSignature: timeSignature
                        });
                        i = j - 1;
                    }
                    // 为中间变速的情况创建小节并分配id
                    combined[0].id = 0;
                    for (let i = 1; i < combined.length; i++) {
                        const c = combined[i];
                        let j = i - 1;
                        let last = combined[j];
                        const ticksPerBar = m.header.tick * last.timeSignature[0] * 4 / last.timeSignature[1];
                        if (c.timeSignature) {
                            // 理论上小节改变不会出现在小节中 但为了兼容奇怪的MIDI需要微调
                            // 四舍五入到最近的小节开始位置
                            const bars = Math.round((c.ticks - last.ticks) / ticksPerBar);
                            c.id = bars + last.id;
                            const dt = last.ticks + bars * ticksPerBar - c.ticks;
                            if (dt === 0) continue;
                            // 平移后面所有事件
                            for (const mt of m.tracks) {
                                const notes = mt.notes;
                                // 找到第一个ticks大于等于c.ticks的事件
                                let idx = notes.findIndex(ev => ev.ticks >= c.ticks);
                                if (idx === -1) continue;
                                for (let k = idx; k < notes.length; k++) notes[k].ticks += dt;
                            }
                            for (let k = i; k < combined.length; k++) combined[k].ticks += dt;
                        } else {
                            // 如果节奏改变出现在小节中：
                            // 前1/2: 放到小节头; 后1/2: 放到下一个小节头
                            // 总是创建小节
                            while (c.ticks < last.ticks) last = combined[--j];
                            const bars = Math.floor((c.ticks - last.ticks) / ticksPerBar);
                            const offset = c.ticks - last.ticks - bars * ticksPerBar;
                            c.timeSignature = last.timeSignature;
                            if (offset < (ticksPerBar >> 1)) {
                                c.id = last.id + bars;
                                c.ticks = last.ticks + bars * ticksPerBar;
                            } else {
                                c.id = last.id + bars + 1;
                                c.ticks = last.ticks + (bars + 1) * ticksPerBar;
                            }
                        }
                    }
                    // 合并id相同的小节
                    rhy.length = 0;
                    let lastbpm = 120, lastTimeSignature = [4, 4];
                    for (let i = 0; i < combined.length; i++) {
                        const c = combined[i];
                        c.bpm ??= lastbpm;
                        c.timeSignature ??= lastTimeSignature;
                        let j = i + 1;
                        while (j < combined.length && combined[j].id == c.id) {
                            c.bpm = combined[j].bpm ?? c.bpm;
                            c.timeSignature = combined[j].timeSignature ?? c.timeSignature;
                            j++;
                        } rhy.push(c);
                        i = j - 1;
                        lastbpm = c.bpm;
                        lastTimeSignature = c.timeSignature;
                    } tickTimeTable = rhy;
                    // 设置节奏
                    const beats = parent.BeatBar.beats;
                    beats.length = 0;
                    for (const t of tickTimeTable) {
                        const msPerMeasure = 240000 * t.timeSignature[0] / (t.timeSignature[1] * t.bpm);
                        beats.push(new eMeasure(
                            t.id, -1, t.timeSignature[0], t.timeSignature[1], msPerMeasure
                        ));
                    } beats.check();
                }

                const chArray = [];
                let chArrayIndex = 0;
                for (const mt of m.tracks) {
                    if (mt.notes.length == 0) continue;
                    let tickTimeIdx = -1;
                    let startTick = 0;
                    let nexttickTimeChange = 0;
                    let tickTime = 0;   // 一个tick的毫秒数/parent.dt
                    let msBefore = 0;   // 用parent.dt归一化后的之前的时间
                    let _timeOffset = 0;
                    const checkChange = (tick) => {
                        while (tick >= nexttickTimeChange) {
                            msBefore += (nexttickTimeChange - startTick) * tickTime;
                            tickTimeIdx++;
                            startTick = nexttickTimeChange;
                            nexttickTimeChange = tickTimeTable[tickTimeIdx + 1]?.ticks ?? Infinity;
                            tickTime = 60000 / (tickTimeTable[tickTimeIdx].bpm * m.header.tick * parent.dt);
                            _timeOffset = msBefore - startTick * tickTime;
                        } return tickTime;
                    }; checkChange(1);

                    const ch = chdiv.addChannel();
                    if (!ch) break; // 音轨已满，addChannel会返回undefined同时alert，所以只要break
                    const chid = ch.index;
                    ch.name = `导入音轨${chid}`;
                    ch.ch.instrument = mt.instruments[0]?.number || 0;
                    ch.instrument = TinySynth.instrument[ch.ch.instrument];

                    // 音符强度归一化到0-127 演奏和导出时用的是“通道音量*音符音量/127”
                    let maxIntensity = mt.notes.reduce((a, b) => a.intensity > b.intensity ? a : b).intensity;
                    ch.ch.volume = maxIntensity;

                    chArray[chArrayIndex++] = mt.notes.map((nt) => {
                        let t = checkChange(nt.ticks + 1);
                        const start = _timeOffset + nt.ticks * t;
                        const endTick = nt.ticks + nt.durationTicks;
                        let end;
                        if (endTick > nexttickTimeChange) { // 跨变速区间
                            // 暂存状态
                            const store = [tickTimeIdx, startTick, nexttickTimeChange, tickTime, msBefore, _timeOffset];
                            t = checkChange(nt.ticks + nt.durationTicks + 1);
                            end = _timeOffset + endTick * t;
                            // 恢复状态
                            [tickTimeIdx, startTick, nexttickTimeChange, tickTime, msBefore, _timeOffset] = store;
                        } else end = _timeOffset + endTick * t;
                        return {    // 理应给x1和x2取整，但是为了尽量不损失信息就不取整了 不取整会导致导出midi时要取整
                            // x1: msBefore + (nt.ticks - startTick) * t,
                            x1: start,
                            x2: end,
                            y: nt.midi - 24,
                            ch: chid,
                            selected: false,
                            v: nt.intensity / maxIntensity * 127
                        };
                    });
                }
                for (const ch of chArray) parent.MidiAction.midi.push(...ch);
                parent.MidiAction.midi.sort((a, b) => a.x1 - b.x1);
                chdiv.switchUpdateMode(true);   // 打开更新并一次性处理积压请求
            });
        },
    }
}