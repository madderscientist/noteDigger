/**
 * 管理用户绘制的midi的播放
 * @param {App} parent 
 */
function _MidiPlayer(parent) {
    this.priorT = 1000 / 59;    // 实际稳定在60帧，波动极小
    this.realT = 1000 / 59;
    this._last = performance.now();
    this.lastID = -1;
    this.restart = (onlyBeat = false) => {
        // 需要-1，防止当前时刻开始的音符不被播放
        const msnow = parent.AudioPlayer.audio.currentTime * 1000;
        if (!onlyBeat) this.lastID = ((msnow / parent.dt) | 0) - 1;
        this._beatIter = parent.BeatBar.beats.iterator(msnow, true);
        const p = this._beatIter.next();
        if (p.done === false) {
            const m = p.value;
            this._beatNowEnds = m.start + m.interval;
        } else {
            this._beatNowEnds = -1;
        }
    };
    this.update = () => {
        // 一阶预测
        let tnow = performance.now();
        // 由于requestAnimationFrame在离开界面的时候会停止，所以要设置必要的限定
        if (tnow - this._last < (this.priorT << 1)) this.realT = 0.2 * (tnow - this._last) + 0.8 * this.realT;   // IIR低通滤波
        this._last = tnow;
        if (parent.AudioPlayer.audio.paused) return;
        const predictT = parent.time + 0.5 * (this.realT + this.priorT); // 先验和实测的加权和
        const predictID = (predictT / parent.dt) | 0;
        // 寻找(mp.lastID, predictID]之间的音符
        const m = parent.MidiAction.midi;
        if (m.length > 0) { // 二分查找要求长度大于0
            let lastAt = m.length;
            {   // 二分查找到第一个x1>mp.lastID的音符
                let l = 0, r = lastAt - 1;
                while (l <= r) {
                    let mid = (l + r) >> 1;
                    if (m[mid].x1 > this.lastID) {
                        r = mid - 1;
                        lastAt = mid;
                    } else l = mid + 1;
                }
            }
            for (; lastAt < m.length; lastAt++) {
                const nt = m[lastAt];
                if (nt.x1 > predictID) break;
                if (parent.MidiAction.channelDiv.channel[nt.ch].mute) continue;
                parent.synthesizer.play({
                    id: nt.ch,
                    f: parent.Keyboard.freqTable[nt.y],
                    v: nt.v,    // 用户创建的音符不可单独调整音量，为undefined，会使用默认值
                    t: (parent.time - nt.x1 * parent.dt) / 1000,
                    last: (nt.x2 - nt.x1) * parent.dt / 1000
                });
            }
        }
        // 节拍播放
        if (this._ifBeat && this._beatNowEnds > 0) {
            const endms = this._beatNowEnds;
            // 较为宽裕的时间判断
            if (endms < predictT + this.priorT) {
                this.playBeatSound(parent.audioContext.currentTime + (endms - parent.time) / 1000);
                const p = this._beatIter.next();
                if (p.done === false) {
                    const m = p.value;
                    this._beatNowEnds = m.start + m.interval;
                } else {
                    this._beatNowEnds = -1;
                }
            }
        }
        this.lastID = predictID;
    };

    // 播放节拍
    this._ifBeat = false;
    this._beatIter = null;
    this._beatNowEnds = -1;
    this.switchBeatMode = (ifBeat) => {
        this._ifBeat = ifBeat;
        if (ifBeat === false) return;
        this.initBeatSound().then(() => {
            if (parent.AudioPlayer.audio.paused === false) this.restart(true);
        });
    };
    this.beatBuffer = null;
    this.initBeatSound = async () => {
        if (this.beatBuffer) return;
        try {
            // 利用 fetch 转换 Base64 为 ArrayBuffer
            const CLICK_SOUND_BASE64 = "data:audio/mpeg;base64,SUQzBAAAAAABRlRFTkMAAAAMAAADT3JpZ2luYXRvcgBUWFhYAAAAKgAAA29yaWdpbmF0b3JfcmVmZXJlbmNlAE9yaWdpbmF0b3JSZWZlcmVuY2UAVERSQwAAAAwAAAMyMDAwOjAwOjAwAFRYWFgAAAAeAAADY29kaW5nX2hpc3RvcnkAQ29kaW5nSGlzdG9yeQBUWFhYAAAAEgAAA3RpbWVfcmVmZXJlbmNlADAAVFNTRQAAAA4AAANMYXZmNjIuNC4xMDAAAAAAAAAAAAAAAP/7UMAAAAAAAAAAAAAAAAAAAAAAAEluZm8AAAAPAAAAAgAAAnEAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv//////////////////////////////////////////////////////////////////AAAAAExhdmM2Mi4xMwAAAAAAAAAAAAAAACQEWgAAAAAAAAJxo1jtAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/+1DEAAAJTFdXNBSAAZig7j8woAD1QEAAAIAJQAUExuAC/vf4Qyc5oyMVo9UFYJgmCYJhsnB8EDkH38QA+UBCJAQBAEHMg+D/wffg4GC4Pg+7+oHz5QEP+UDHOf4IAhl6hqZmRkhAAA2Gw2GAwIAmkAHzrD7iq7X2AqopRMhZ060gz1e2F2Ng2m1AtBbGIrF+IwgRk5RPyEesIcvUwet9xkRllReab+aw4cTGp5rf5EyEI9IGY3///RCJomX/8Akgk06BXPUgABsYAFWM2a0N//tSxAUDy817Jv2FAAgAADSAAAAET0ApeqwoITVM6TNhUkXiVM41cLoCkA0DURhcgUQKINoiiZ6mkI9HpykJKab6mmmmzjjWOOepptc447mm6HHHfzjv6///////6Hf//oc+v//1NNIRqkxBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=";
            const response = await fetch(CLICK_SOUND_BASE64);
            const arrayBuffer = await response.arrayBuffer();
            this.beatBuffer = await parent.audioContext.decodeAudioData(arrayBuffer);
        } catch (e) {
            alert("节拍音频解码失败:", e);
        }
    };
    this.playBeatSound = (time = 0) => {
        if (!this.beatBuffer) return;
        const source = parent.audioContext.createBufferSource();
        source.buffer = this.beatBuffer;
        source.connect(parent.audioContext.destination);
        source.start(time);
    };
}