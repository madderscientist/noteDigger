/// <reference path="contextMenu.js" />

/**
 * 顶部时间轴
 * @param {App} parent 
 */
function _TimeBar(parent) {
    this.interval = 10; // 每个标注的间隔块数 在updateInterval中更新
    // 重复区间参数 单位：毫秒 如果start>end则区间不起作用
    this.repeatStart = -1;
    this.repeatEnd = -1;
    /**
     * 设置重复区间专用函数 便于统一管理行为副作用
     * @param {number || null} start 单位：毫秒
     * @param {number || null} end 单位：毫秒
     */
    this.setRepeat = (start = null, end = null) => {
        if (start !== null) this.repeatStart = start;
        if (end !== null) this.repeatEnd = end;
    };
    /**
     * 毫秒转 分:秒:毫秒
     * @param {Number} ms 毫秒数
     * @returns [分,秒,毫秒]
     */
    this.msToClock = (ms) => {
        return [
            Math.floor(ms / 60000),
            Math.floor((ms % 60000) / 1000),
            ms % 1000 | 0
        ];
    };
    this.msToClockString = (ms) => {
        const t = this.msToClock(ms);
        return `${t[0].toString().padStart(2, "0")}:${t[1].toString().padStart(2, "0")}:${t[2].toString().padStart(3, "0")}`;
    };
    // timeBar的上半部分画时间轴
    this.update = () => {
        const canvas = parent.timeBar;
        const ctx = parent.timeBar.ctx;
        let idstart = Math.ceil(parent.idXstart / this.interval - 0.1); // 画面中第一个时间点的序号
        let dt = this.interval * parent.dt;     // 时间的步长
        let dp = parent.width * this.interval;  // 像素的步长
        let timeAt = dt * idstart;              // 对应的毫秒
        let p = idstart * dp - parent.scrollX;  // 对应的像素
        let h = canvas.height >> 1;             // 上半部分
        ctx.fillStyle = '#25262d';
        ctx.fillRect(0, 0, canvas.width, h);
        ctx.fillStyle = '#8e95a6';
        //== 画刻度 标时间 ==//
        ctx.strokeStyle = '#ff0000';
        ctx.beginPath();
        for (let endPix = canvas.width + (dp >> 1); p < endPix; p += dp, timeAt += dt) {
            ctx.moveTo(p, 0);
            ctx.lineTo(p, h);
            ctx.fillText(this.msToClockString(timeAt), p - 28, 16);
        } ctx.stroke();
        //== 画重复区间 ==//
        let begin = parent._width * this.repeatStart / parent.dt - parent.scrollX;  // 单位：像素
        let end = parent._width * this.repeatEnd / parent.dt - parent.scrollX;
        const spectrum = parent.spectrum.ctx;
        const spectrumHeight = parent.spectrum.height;
        // 画线
        if (begin >= 0 && begin < canvas.width) {   // 画左边
            ctx.beginPath(); spectrum.beginPath();
            ctx.strokeStyle = spectrum.strokeStyle = '#20ff20';
            ctx.moveTo(begin, 0); ctx.lineTo(begin, canvas.height);
            spectrum.moveTo(begin, 0); spectrum.lineTo(begin, spectrumHeight);
            ctx.stroke(); spectrum.stroke();
        }
        if (end >= 0 && end < canvas.width) {       // 画右边
            ctx.beginPath(); spectrum.beginPath();
            ctx.strokeStyle = spectrum.strokeStyle = '#ff2020';
            ctx.moveTo(end, 0); ctx.lineTo(end, canvas.height);
            spectrum.moveTo(end, 0); spectrum.lineTo(end, spectrumHeight);
            ctx.stroke(); spectrum.stroke();
        }
        // 画区间 如果begin>end则区间不起作用，不绘制
        if (begin < end) {
            begin = Math.max(begin + 1, 0); end = Math.min(end - 1, canvas.width);
            ctx.fillStyle = spectrum.fillStyle = '#80808044';
            ctx.fillRect(begin, 0, end - begin, canvas.height);
            spectrum.fillRect(begin, 0, end - begin, spectrumHeight);
        }
        //== 画当前时间指针 ==//
        spectrum.strokeStyle = 'white';
        begin = parent.time / parent.dt * parent._width - parent.scrollX;
        if (begin >= 0 && begin < canvas.width) {
            spectrum.beginPath();
            spectrum.moveTo(begin, 0);
            spectrum.lineTo(begin, spectrumHeight);
            spectrum.stroke();
        }
    };
    this.updateInterval = () => {   // 根据parent.width改变 在width的setter中调用
        const fontWidth = parent.timeBar.ctx.measureText('00:00:000').width * 1.2;
        // 如果间距小于fontWidth则细分
        this.interval = Math.max(1, Math.ceil(fontWidth / parent._width));
    };
    this.contextMenu = new ContextMenu([
        {
            name: "设置重复区间开始位置",
            callback: (e_father, e_self) => {
                this.setRepeat((e_father.offsetX + parent.scrollX) * parent.TperP, null);
            }
        }, {
            name: "设置重复区间结束位置",
            callback: (e_father, e_self) => {
                this.setRepeat(null, (e_father.offsetX + parent.scrollX) * parent.TperP);
            }
        }, {
            name: '<span style="color: red;">取消重复区间</span>',
            onshow: () => this.repeatStart >= 0 || this.repeatEnd >= 0,
            callback: () => {
                this.setRepeat(-1, -1);
            }
        }, {
            name: "从此处播放",
            callback: (e_father, e_self) => {
                parent.AudioPlayer.stop();
                parent.AudioPlayer.start((e_father.offsetX + parent.scrollX) * parent.TperP);
            }
        }
    ]);
}