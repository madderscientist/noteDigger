/**
 * 管理相位显示
 * 会使用 parent.layers.spectrum 画布
 * @param {App} parent 
 */
function _FreqLine(parent) {
    this._phase = null;
    this.visible = true;
    this.freq2Y = (freq) => (Math.log2(freq / parent.Keyboard.freqTable[0]) * 12 + 0.5) * parent._height;
    this.update = () => {
        if (!this.visible || !this._phase) return;
        const canvas = parent.layers.freqline;
        if (!canvas) return;
        const ctx = canvas.ctx;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = "#000000";
        ctx.beginPath();
        const scrollY = parent.scrollY;
        const h = parent.layers.height;
        let rectx = parent.rectXstart;
        for (let y = parent.idYstart; y < parent.idYend; y++) {
            const phase = this._phase[y];
            for (let x = Math.max(0, parent.idXstart - 1); x < parent.idXend;) {
                while (x < parent.idXend && phase[x] < 1) x++;
                ctx.moveTo(rectx + (x - parent.idXstart + 1) * parent._width, h - this.freq2Y(phase[x]) + scrollY);
                x++;
                while (x < parent.idXend && phase[x] >= 1) {
                    ctx.lineTo(rectx + (x - parent.idXstart + 1) * parent._width, h - this.freq2Y(phase[x]) + scrollY);
                    x++;
                }
            }
        }
        ctx.stroke();
        canvas.dirty = false;
    };

    Object.defineProperty(this, "phase", {
        set: (v) => {
            if (!v) return;
            this._phase = v;
            if (parent.layers.freqline) return;
            const canvas = document.createElement("canvas");
            canvas.style.zIndex = 15;
            parent.layerContainer.appendChild(canvas);
            const ctx = canvas.ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
            parent.layers.freqline = canvas;
            canvas.width = parent.layers.width;
            canvas.height = parent.layers.height;
            canvas.dirty = true;
        },
        get: () => this._phase
    });
}