/**
 * 管理用户绘制的midi的播放
 * @param {App} parent 
 */
function _MidiPlayer(parent) {
    this.priorT = 1000 / 59;    // 实际稳定在60帧，波动极小
    this.realT = 1000 / 59;
    this._last = performance.now();
    this.lastID = -1;
    this.restart = () => {
        // 需要-1，防止当前时刻开始的音符不被播放
        this.lastID = ((parent.AudioPlayer.audio.currentTime * 1000 / parent.dt) | 0) - 1;
    };
    this.update = () => {
        // 一阶预测
        let tnow = performance.now();
        // 由于requestAnimationFrame在离开界面的时候会停止，所以要设置必要的限定
        if (tnow - this._last < (this.priorT << 1)) this.realT = 0.2 * (tnow - this._last) + 0.8 * this.realT;   // IIR低通滤波
        this._last = tnow;
        if (parent.AudioPlayer.audio.paused) return;
        let predictT = parent.time + 0.5 * (this.realT + this.priorT); // 先验和实测的加权和
        let predictID = (predictT / parent.dt) | 0;
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
                    t: parent.AudioPlayer.audio.currentTime - (nt.x1 * parent.dt) / 1000,
                    last: (nt.x2 - nt.x1) * parent.dt / 1000
                });
            }
        }
        this.lastID = predictID;
    }
}