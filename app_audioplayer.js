/// <reference path="fakeAudio.js" />

/**
 * 音频播放
 * @param {App} parent 
 */
function _AudioPlayer(parent) {
    this.name = "请上传文件";   // 在parent.io.onfile中赋值
    this.audio = new Audio();   // 在parent.io.onfile中重新赋值 此处需要一个占位
    this.play_btn = document.getElementById("play-btn");
    this.durationString = '';   // 在parent.Analyser.audio.ondurationchange中更新
    this.autoPage = false;      // 自动翻页
    this.repeat = true;         // 是否区间循环
    this.EQfreq = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    // midiMode下url为duration
    this.createAudio = (url) => {
        return new Promise((resolve, reject) => {
            const a = parent.midiMode ? new FakeAudio(url) : new Audio(url);
            a.loop = false;
            a.volume = parseFloat(document.getElementById('audiovolumeControl').value);
            a.ondurationchange = () => {
                let ms = a.duration * 1000;
                this.durationString = parent.TimeBar.msToClockString(ms);
                parent.BeatBar.beats.maxTime = ms;
            };
            a.onended = () => {
                parent.time = 0;
                this.stop();
            };
            a.onloadeddata = () => {
                if (!parent.midiMode) {
                    this.setEQ();
                    if (parent.audioContext.state == 'suspended') parent.audioContext.resume().then(() => a.pause());
                    document.title = this.name + "~扒谱";
                } else {
                    document.title = this.name;
                }
                a.playbackRate = document.getElementById('speedControl').value; // load之后会重置速度
                parent.time = 0;
                resolve(a);
                a.onloadeddata = null;  // 一次性 防止多次构造
                this.play_btn.firstChild.textContent = parent.TimeBar.msToClockString(parent.time);
                this.play_btn.lastChild.textContent = this.durationString;
            };
            a.onerror = (e) => {    // 如果正常分析，是用不到这个回调的，因为WebAudioAPI读取就会报错。但上传已有结果不会再分析
                // 发现一些如mov格式的视频，不在video/的支持列表中，用.readAsDataURL转为base64后无法播放，会触发这个错误
                // 改正方法是用URL.createObjectURL(file)生成一个blob地址而不是解析为base64
                console.error("Audio load error", e);
                reject(e);
                // 不再抛出错误事件 调用者自行处理
                // parent.event.dispatchEvent(new Event('fileerror'));
            };
            this.setAudio(a);
        });
    };

    let _crossFlag = false;     // 上一时刻是否在重复区间终点左侧
    this.update = () => {
        const a = this.audio;
        if (a.readyState != 4 || a.paused) return;
        parent.time = a.currentTime * 1000;  // 【重要】更新时间
        // 重复区间
        let crossFlag = parent.time < parent.TimeBar.repeatEnd;
        if (this.repeat && parent.TimeBar.repeatEnd >= parent.TimeBar.repeatStart) {   // 重复且重复区间有效
            if (_crossFlag && !crossFlag) {  // 从重复区间终点左侧到右侧
                parent.time = parent.TimeBar.repeatStart;
                a.currentTime = parent.time / 1000;
            }
        }
        _crossFlag = crossFlag;
        this.play_btn.firstChild.textContent = parent.TimeBar.msToClockString(parent.time);
        this.play_btn.lastChild.textContent = this.durationString;
        // 自动翻页
        if (parent.time > parent.idXend * parent.dt || parent.time < parent.idXstart * parent.dt) {
            // 在视图外
            if (this.autoPage)
                parent.scroll2(((parent.time / parent.dt - 1) | 0) * parent._width, parent.scrollY);
        } else parent.layers.action.dirty = true;
    };
    /**
     * 在指定的毫秒数开始播放
     * @param {number} at 开始的毫秒数 如果是负数，则从当下开始
     */
    this.start = (at) => {
        const a = this.audio;
        if (a.readyState != 4) return;
        if (at >= 0) a.currentTime = at / 1000;
        _crossFlag = false;    // 置此为假可以暂时取消重复区间
        parent.MidiPlayer.restart();
        if (a.readyState == 4) a.play();
        else a.oncanplay = () => {
            a.play();
            a.oncanplay = null;
        };
    };
    this.stop = () => {
        this.audio.pause();
        parent.synthesizer.stopAll();
    };
    this.setEQ = (f = this.EQfreq) => {
        const a = this.audio;
        if (a.EQ) return;
        // 由于createMediaElementSource对一个audio只能调用一次，所以audio的EQ属性只能设置一次
        const source = parent.audioContext.createMediaElementSource(a);
        let last = source;
        a.EQ = {
            source: source,
            filter: f.map((v) => {
                const filter = parent.audioContext.createBiquadFilter();
                filter.type = "peaking";
                filter.frequency.value = v;
                filter.Q.value = 1;
                filter.gain.value = 0;
                last.connect(filter);
                last = filter;
                return filter;
            })
        };
        last.connect(parent.audioContext.destination);
    };
    this.setAudio = (newAudio) => {
        const a = this.audio;
        if (a) {
            a.pause();
            a.onerror = null;   // 防止触发fileerror
            a.src = '';
            if (a.EQ) {
                a.EQ.source.disconnect();
                for (const filter of a.EQ.filter) filter.disconnect();
            }
            // 配合传参为URL.createObjectURL(file)使用，防止内存泄露
            URL.revokeObjectURL(a.src);
        }
        this.audio = newAudio;
    };

    this.play_btn.onclick = () => {
        if (this.audio.paused) this.start(-1);
        else this.stop();
        this.play_btn.blur();   // 防止焦点在按钮上导致空格响应失败
    };
}