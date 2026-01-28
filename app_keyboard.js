/// <reference path="./dataProcess/analyser.js" />

/**
 * 左侧键盘
 * 会使用 parent.keyboard 画布
 * @param {App} parent 
 */
function _Keyboard(parent) {
    /**
     * 选中了哪个音，音的编号以midi协议为准（C1序号为24）
     * 更新链: 'onmousemove' -> parent.mouseY setter -> this.highlight
     */
    this.highlight = -1;
    this.freqTable = new FreqTable(440);    // 在parent.Analyser.stft中更新

    // 以下为画键盘所需
    const _idchange = new Int8Array([2, 2, 1, 2, 2, 2, -10, 2, 3, 2, 2, 2]);    // id变化
    const _ychange = new Float32Array(12);    // 纵坐标变化，随this.height一起变化
    this.setYchange = (h) => {  // 需注册到parent.height setter中 且需要一次立即的更新（在parent中实现）
        _ychange.set([
            -1.5 * h, -2 * h, -1.5 * h, -1.5 * h, -2 * h, -2 * h, -1.5 * h,
            -2 * h, -3 * h, -2 * h, -2 * h, -2 * h
        ]);
    };

    /**
     * 仅当: 视野垂直变化 或 this.highlight 更改 时需要更新
     * 是否更新的判断 交给parent完成
     */
    this.update = () => {
        // 绘制频谱区音符高亮
        const actionCtx = parent.layers.action.ctx;
        actionCtx.fillStyle = "#ffffff4f";
        const noteY = parent.layers.height - (this.highlight - 24) * parent._height + parent.scrollY;
        actionCtx.fillRect(0, noteY, parent.layers.width, -parent._height);

        const ctx = parent.keyboard.ctx;
        const w = parent.keyboard.width;
        const w2 = w * 0.618;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, parent.keyboard.height);

        let noteID = parent.idYstart + 24;  // 最下面对应的音的编号
        const note = noteID % 12;           // 一个八度中的第几个音
        let baseY = parent.rectYstart + note * parent._height;  // 这个八度左下角的y坐标
        noteID -= note;                     // 这个八度C的编号

        while (true) {
            ctx.beginPath();    // 必须写循环内
            ctx.fillStyle = 'orange';
            for (let i = 0, rectY = baseY, id = noteID; i < 7 & rectY > 0; i++) {   // 画白键
                let dy = _ychange[i];
                if (this.highlight == id) ctx.fillRect(0, rectY, w, dy);   // 被选中的
                ctx.moveTo(0, rectY);   // 画线即可 下划线
                ctx.lineTo(w, rectY);
                rectY += dy;
                id += _idchange[i];
            } ctx.stroke();
            // 写音阶名
            ctx.fillStyle = "black"; ctx.fillText(Math.floor(noteID / 12) - 1, w - parent._height * 0.75, baseY - parent._height * 0.3);
            baseY -= parent._height; noteID++;
            for (let i = 7; i < 12; i++) {
                if (this.highlight == noteID) {    // 考虑到只要画一次高亮，不必每次都改fillStyle
                    ctx.fillStyle = '#Ffa500ff';
                    ctx.fillRect(0, baseY, w2, -parent._height);
                    ctx.fillStyle = 'black';
                } else ctx.fillRect(0, baseY, w2, -parent._height);
                baseY += _ychange[i];
                noteID += _idchange[i];
                if (baseY < 0) return;
            }
        }
    };
    // 鼠标点击后发声
    this.mousedown = () => {
        let ch = parent.MidiAction.channelDiv.selected;
        if (!ch || ch.mute) return;
        ch = ch ? ch.ch : parent.synthesizer;
        let nt = ch.play({ f: this.freqTable[this.highlight - 24] });
        let last = this.highlight;     // 除颤
        const tplay = parent.audioContext.currentTime;
        const move = () => {
            if (last === this.highlight) return;
            last = this.highlight;
            let dt = parent.audioContext.currentTime - tplay;
            parent.synthesizer.stop(nt, dt > 0.3 ? 0 : dt - 0.3);
            nt = ch.play({ f: this.freqTable[this.highlight - 24] });
        }; document.addEventListener('mousemove', move);
        const up = () => {
            let dt = parent.audioContext.currentTime - tplay;
            parent.synthesizer.stop(nt, dt > 0.5 ? 0 : dt - 0.5);
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
        }; document.addEventListener('mouseup', up);
    };
}